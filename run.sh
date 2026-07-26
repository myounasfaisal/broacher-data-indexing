#!/usr/bin/env bash
#
# run.sh — start (or restart) the whole local stack.
#
# The app is FOUR kinds of process, not two. Starting only the API gives a
# system that accepts uploads and never processes them, and starting only one
# worker means documents extract strictly one at a time (concurrency IS the
# worker count — see ARCHITECTURE.md §5).
#
#   API          uvicorn app.main:app        :8000    exactly 1
#   Worker       python -m app.worker                 1..N  (default 4)
#   Reconciler   python -m app.reconciler             exactly 1
#   Frontend     vite                        :5173    exactly 1
#
# Usage:
#   ./run.sh                 start everything with the default worker count
#   ./run.sh start 6         start with 6 workers
#   ./run.sh workers 6       change ONLY the worker count, leave the rest running
#   ./run.sh stop            stop everything
#   ./run.sh status          show what's running
#   ./run.sh logs            tail every log at once
#
#   WORKERS=6 ./run.sh       same as './run.sh start 6'
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
LOG_DIR="$ROOT/.run-logs"
BACKEND_PORT=8000
FRONTEND_PORT=5173

# Workers to run when not told otherwise. 4 keeps a batch moving without
# pushing the provider into 429s; the architecture targets up to 6.
DEFAULT_WORKERS="${WORKERS:-4}"

mkdir -p "$LOG_DIR"

BACKEND_PID="$LOG_DIR/backend.pid"
FRONTEND_PID="$LOG_DIR/frontend.pid"
RECONCILER_PID="$LOG_DIR/reconciler.pid"
WORKER_PIDS="$LOG_DIR/workers.pid"   # one PID per line

PY="python3"
[ -x "$BACKEND_DIR/.venv/bin/python" ] && PY="$BACKEND_DIR/.venv/bin/python"

# ── helpers ──────────────────────────────────────────────────────────────

kill_port() {
  local port="$1" pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  fi
  return 0
}

# Stop the PIDs listed in a pidfile. Workers and the reconciler hold no port,
# so the pidfile is the handle; SIGTERM lets a worker finish its current page
# before exiting (see the signal handler in app/worker.py).
kill_pidfile() {
  local file="$1" pid
  [ -f "$file" ] || return 0
  while read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done < "$file"
  rm -f "$file"
  return 0
}

# Count live PIDs in a pidfile, pruning dead ones.
count_pidfile() {
  local file="$1" pid n=0
  [ -f "$file" ] || { echo 0; return 0; }
  while read -r pid; do
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && n=$((n + 1))
  done < "$file"
  echo "$n"
}

# ── start ────────────────────────────────────────────────────────────────

start_backend() {
  echo "Starting API on :$BACKEND_PORT ..."
  cd "$BACKEND_DIR"
  nohup "$PY" -m uvicorn app.main:app --reload --port "$BACKEND_PORT" \
    > "$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$BACKEND_PID"
  cd "$ROOT"
}

start_frontend() {
  echo "Starting frontend on :$FRONTEND_PORT ..."
  cd "$FRONTEND_DIR"
  nohup npm run dev -- --port "$FRONTEND_PORT" \
    > "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$FRONTEND_PID"
  cd "$ROOT"
}

start_reconciler() {
  echo "Starting reconciler (1 instance) ..."
  cd "$BACKEND_DIR"          # must run from backend/ — 'app' is not importable elsewhere
  nohup "$PY" -m app.reconciler > "$LOG_DIR/reconciler.log" 2>&1 &
  echo $! > "$RECONCILER_PID"
  cd "$ROOT"
}

start_workers() {
  local n="$1" i
  echo "Starting $n worker(s) ..."
  cd "$BACKEND_DIR"
  : > "$WORKER_PIDS"
  for ((i = 1; i <= n; i++)); do
    nohup "$PY" -m app.worker > "$LOG_DIR/worker-$i.log" 2>&1 &
    echo $! >> "$WORKER_PIDS"
  done
  cd "$ROOT"
}

stop_workers() {
  kill_pidfile "$WORKER_PIDS"
  # Sweep any strays started by hand outside this script.
  pkill -f "python -m app.worker" 2>/dev/null || true
  return 0
}

stop_all() {
  echo "Stopping API, frontend, workers and reconciler ..."
  stop_workers
  kill_pidfile "$RECONCILER_PID"
  pkill -f "python -m app.reconciler" 2>/dev/null || true
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
  rm -f "$BACKEND_PID" "$FRONTEND_PID"
  echo "Stopped."
}

status() {
  local w r
  if lsof -ti tcp:"$BACKEND_PORT" >/dev/null 2>&1; then
    echo "API:         running on :$BACKEND_PORT"
  else
    echo "API:         NOT RUNNING"
  fi
  if lsof -ti tcp:"$FRONTEND_PORT" >/dev/null 2>&1; then
    echo "Frontend:    running on :$FRONTEND_PORT"
  else
    echo "Frontend:    NOT RUNNING"
  fi

  w="$(count_pidfile "$WORKER_PIDS")"
  if [ "$w" -eq 0 ]; then
    echo "Workers:     NONE — uploads will queue forever once started"
  else
    echo "Workers:     $w running  (concurrency = this number)"
  fi

  r="$(count_pidfile "$RECONCILER_PID")"
  if [ "$r" -eq 0 ]; then
    echo "Reconciler:  NOT RUNNING — stalled/failed documents won't be retried"
  elif [ "$r" -gt 1 ]; then
    echo "Reconciler:  $r running — should be exactly 1"
  else
    echo "Reconciler:  running"
  fi
}

case "${1:-start}" in
  stop)
    stop_all
    ;;
  status)
    status
    ;;
  logs)
    exec tail -n 20 -f "$LOG_DIR"/*.log
    ;;
  workers)
    n="${2:-$DEFAULT_WORKERS}"
    stop_workers
    sleep 1
    start_workers "$n"
    echo "Now running $n worker(s). './run.sh status' to confirm."
    ;;
  start|restart|"")
    n="${2:-$DEFAULT_WORKERS}"
    stop_all
    start_backend
    start_frontend
    start_reconciler
    start_workers "$n"
    echo
    echo "API:       http://localhost:$BACKEND_PORT   (logs: $LOG_DIR/backend.log)"
    echo "Frontend:  http://localhost:$FRONTEND_PORT   (logs: $LOG_DIR/frontend.log)"
    echo "Workers:   $n                        (logs: $LOG_DIR/worker-N.log)"
    echo "Reconciler: 1                        (logs: $LOG_DIR/reconciler.log)"
    echo
    echo "'./run.sh status' to check · './run.sh workers 6' to rescale · './run.sh stop' to stop."
    ;;
  *)
    echo "Usage: $0 [start [N] | workers N | stop | status | logs]" >&2
    exit 1
    ;;
esac
