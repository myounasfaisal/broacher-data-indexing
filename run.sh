#!/usr/bin/env bash
#
# run.sh — start (or restart) both the backend and frontend dev servers.
#
# Usage:
#   ./run.sh            start both; if already running, restart them
#   ./run.sh stop       stop both
#   ./run.sh status     show whether each is running
#
# Backend:  FastAPI/uvicorn on :8000
# Frontend: Vite dev server on :5173
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
LOG_DIR="$ROOT/.run-logs"
BACKEND_PORT=8000
FRONTEND_PORT=5173

mkdir -p "$LOG_DIR"

BACKEND_PID="$LOG_DIR/backend.pid"
FRONTEND_PID="$LOG_DIR/frontend.pid"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  fi
}

stop_all() {
  echo "Stopping backend (:$BACKEND_PORT) and frontend (:$FRONTEND_PORT)..."
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
  rm -f "$BACKEND_PID" "$FRONTEND_PID"
  echo "Stopped."
}

status() {
  for name in "backend:$BACKEND_PORT" "frontend:$FRONTEND_PORT"; do
    local label="${name%%:*}" port="${name##*:}"
    if lsof -ti tcp:"$port" >/dev/null 2>&1; then
      echo "$label: running on :$port"
    else
      echo "$label: not running"
    fi
  done
}

start_backend() {
  echo "Starting backend on :$BACKEND_PORT ..."
  cd "$BACKEND_DIR"
  local py="python3"
  [ -x "$BACKEND_DIR/.venv/bin/python" ] && py="$BACKEND_DIR/.venv/bin/python"
  nohup "$py" -m uvicorn app.main:app --reload --port "$BACKEND_PORT" \
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

case "${1:-start}" in
  stop)
    stop_all
    ;;
  status)
    status
    ;;
  start|restart|"")
    stop_all
    start_backend
    start_frontend
    echo
    echo "Backend:  http://localhost:$BACKEND_PORT   (logs: $LOG_DIR/backend.log)"
    echo "Frontend: http://localhost:$FRONTEND_PORT   (logs: $LOG_DIR/frontend.log)"
    echo "Run './run.sh status' to check, './run.sh stop' to stop."
    ;;
  *)
    echo "Usage: $0 [start|restart|stop|status]" >&2
    exit 1
    ;;
esac
