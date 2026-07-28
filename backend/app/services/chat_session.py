"""
Ephemeral thread store for the chat assistant.

Chats die when the user closes the chat box — there is no conversation history
feature, so there are no `chat_threads` / `chat_messages` tables. A thread is a
dict held in this process, destroyed on explicit close or swept after an idle
TTL.

⚠️ PROCESS-LOCAL. A thread is bound to the backend process that created it.
That is fine for the current single-uvicorn deployment. If the API is ever run
with multiple workers or replicas, a follow-up message can land on a process
that has never seen the thread and will 404 — at that point this must move to
Redis or a TTL table in Postgres. Nothing else in the design changes.

Why server-side rather than letting the client hold the transcript and re-send
it: a client that owns the transcript can forge assistant turns, and a forged
assistant turn is a prompt-injection path straight into the tool layer.

The permanent record lives in `audit_log`, written per exchange by chat_agent —
so a recommendation stays reconstructable long after the chat is gone.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import eff_int, settings


class ThreadNotFound(Exception):
    """No live thread with that id for this user (closed, expired, or never existed)."""


class ThreadFull(Exception):
    """The thread hit chat_max_messages. The UI offers a new chat."""


@dataclass
class ChatThread:
    id: str
    user_id: str
    # Provider-shaped history: [{"role": "user"|"assistant", "content": ...}].
    # Tool traffic is NOT retained — it is large, and the assistant's answer
    # already carries whatever mattered from it.
    messages: list[dict[str, Any]] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_used_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def touch(self) -> None:
        self.last_used_at = datetime.now(timezone.utc)


_threads: dict[str, ChatThread] = {}
_lock = threading.Lock()


def _sweep_locked() -> None:
    """Drop idle threads. Called under the lock on every access — the store is
    small enough that a dedicated timer would be more machinery than value."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=settings.chat_ttl_minutes)
    stale = [tid for tid, t in _threads.items() if t.last_used_at < cutoff]
    for tid in stale:
        _threads.pop(tid, None)


def create(user_id: str) -> ChatThread:
    thread = ChatThread(id=str(uuid.uuid4()), user_id=user_id)
    with _lock:
        _sweep_locked()
        _threads[thread.id] = thread
    return thread


def get(thread_id: str, user_id: str) -> ChatThread:
    """
    Fetch a live thread. The user_id check is ownership enforcement, not just a
    lookup detail — thread ids are guessable-shaped uuids and one user must
    never be able to read or extend another's conversation.
    """
    with _lock:
        _sweep_locked()
        thread = _threads.get(thread_id)
        if thread is None or thread.user_id != user_id:
            raise ThreadNotFound(thread_id)
        thread.touch()
        return thread


def close(thread_id: str, user_id: str) -> bool:
    """Destroy a thread. Idempotent — closing an already-gone chat is not an error."""
    with _lock:
        thread = _threads.get(thread_id)
        if thread is None or thread.user_id != user_id:
            return False
        _threads.pop(thread_id, None)
        return True


def append(thread: ChatThread, message: dict[str, Any]) -> None:
    """
    Add one turn, enforcing the cap.

    A hard stop, not a rolling window: silently dropping the oldest turns
    produces an assistant that inexplicably forgets what it was told four
    messages ago, which reads as a bug. Refusing and offering a new chat is
    honest and keeps cost per thread bounded.
    """
    if len(thread.messages) >= eff_int("chat_max_messages"):
        raise ThreadFull(thread.id)
    thread.messages.append(message)
    thread.touch()


def remaining(thread: ChatThread) -> int:
    return max(0, eff_int("chat_max_messages") - len(thread.messages))
