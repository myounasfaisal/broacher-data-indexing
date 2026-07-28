"""
Chat assistant endpoints — viewer-facing (all three roles, same as /search).

POST   /chat/threads              open an ephemeral chat
POST   /chat/threads/{id}/messages  ask something, get an answer + cited rows
DELETE /chat/threads/{id}         close the chat (destroys it immediately)

Threads live in process memory and die on close or idle timeout — there is no
chat history feature. The permanent record is one audit_log row per exchange.
"""

# NOTE: no `from __future__ import annotations` here — postponed (string)
# annotations break FastAPI's parameter analysis on endpoints wrapped by
# slowapi's decorator (the body model degrades to a query param). Same class of
# gotcha as the one documented in routers/search.py.
import asyncio
import json
import queue
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.config import eff_bool, eff_int, settings
from app.dependencies import require_user
from app.rate_limit import limiter
from app.schemas.chat import (
    ChatMessageRequest,
    ChatReplyResponse,
    ChatThreadResponse,
)
from app.services import chat_agent, chat_providers, chat_session

router = APIRouter(prefix="/chat", tags=["chat"])


def _require_enabled() -> None:
    """The feature ships dark; CHAT_ENABLED turns it on per environment."""
    if not eff_bool("chat_enabled"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The chat assistant is not enabled on this deployment.",
        )


@router.post("/threads", response_model=ChatThreadResponse)
async def open_thread(
    user_id: str = Depends(require_user),
) -> ChatThreadResponse:
    """Open a chat. Cheap — no model call, no database write."""
    _require_enabled()
    thread = chat_session.create(user_id)
    return ChatThreadResponse(
        thread_id=thread.id,
        messages_remaining=chat_session.remaining(thread),
    )


@router.post("/threads/{thread_id}/messages", response_model=ChatReplyResponse)
@limiter.limit(settings.chat_rate_limit)  # every call hits an external LLM API —
# same budget-protection pattern as the upload and AI-search endpoints
async def send_message(
    request: Request,  # required by slowapi's limiter
    thread_id: str,
    body: ChatMessageRequest,
    user_id: str = Depends(require_user),
) -> ChatReplyResponse:
    _require_enabled()

    try:
        # The provider call is blocking network I/O, and the agent loop makes
        # several — keep it off the event loop.
        result = await asyncio.to_thread(
            chat_agent.send,
            user_id=user_id,
            thread_id=thread_id,
            message=body.message,
            context=body.context.model_dump() if body.context else None,
        )
    except chat_session.ThreadNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This chat has expired. Start a new one.",
        ) from exc
    except chat_session.ThreadFull as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"This chat has reached its {eff_int('chat_max_messages')}-message "
                "limit. Start a new chat to continue."
            ),
        ) from exc
    except chat_agent.ChatDisabled as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The chat assistant is not enabled on this deployment.",
        ) from exc
    except chat_providers.ChatProviderError as exc:
        # 502, matching /search/ai: the failure is upstream, not the client's.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The assistant could not answer: {exc}",
        ) from exc

    return ChatReplyResponse(**result)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.post("/threads/{thread_id}/messages/stream")
@limiter.limit(settings.chat_rate_limit)
async def send_message_stream(
    request: Request,
    thread_id: str,
    body: ChatMessageRequest,
    user_id: str = Depends(require_user),
):
    """
    Same exchange as the endpoint above, delivered as Server-Sent Events so the
    UI can report progress during the ~30s an answer takes.

    Event types on the wire:
      {"type": "thinking"}                       model is reasoning
      {"type": "tool", "name", "detail"}         about to run a lookup
      {"type": "tool_done", "name", "count"}     lookup returned N rows
      {"type": "done", ...ChatReplyResponse}     final answer + cited rows
      {"type": "error", "status", "detail"}      failure, mid-stream

    NOTE ON ERRORS: once the response has started streaming the status code is
    already 200 on the wire, so failures arrive as an `error` EVENT rather than
    an HTTP status. The client must handle that — a stream that ends without a
    `done` is not a success.

    The agent runs in a worker thread (it is blocking I/O). Its progress
    callback fires on that thread, so events cross back to the event loop
    through a thread-safe queue rather than being awaited directly.
    """
    _require_enabled()

    events: queue.Queue[dict[str, Any] | None] = queue.Queue()
    SENTINEL = None

    def on_event(event: dict[str, Any]) -> None:
        events.put(event)

    def run() -> None:
        try:
            result = chat_agent.send(
                user_id=user_id,
                thread_id=thread_id,
                message=body.message,
                context=body.context.model_dump() if body.context else None,
                on_event=on_event,
            )
            events.put({"type": "done", **result})
        except chat_session.ThreadNotFound:
            events.put({"type": "error", "status": 404,
                        "detail": "This chat has expired. Start a new one."})
        except chat_session.ThreadFull:
            events.put({"type": "error", "status": 409, "detail": (
                f"This chat has reached its {eff_int('chat_max_messages')}-message "
                "limit. Start a new chat to continue.")})
        except chat_agent.ChatDisabled:
            events.put({"type": "error", "status": 503,
                        "detail": "The chat assistant is not enabled."})
        except chat_providers.ChatProviderError as exc:
            events.put({"type": "error", "status": 502,
                        "detail": f"The assistant could not answer: {exc}"})
        except Exception as exc:  # noqa: BLE001 - must not hang the stream
            events.put({"type": "error", "status": 500, "detail": str(exc)})
        finally:
            events.put(SENTINEL)

    async def stream() -> AsyncIterator[str]:
        task = asyncio.create_task(asyncio.to_thread(run))
        loop = asyncio.get_running_loop()
        try:
            while True:
                # get() is blocking, so it goes through the executor too —
                # otherwise it would stall the whole event loop.
                event = await loop.run_in_executor(None, events.get)
                if event is SENTINEL:
                    break
                yield _sse(event)
        finally:
            await task

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Stops nginx buffering the stream into one chunk at the end,
            # which would defeat the entire point of streaming progress.
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
async def close_thread(
    thread_id: str,
    user_id: str = Depends(require_user),
) -> None:
    """
    Close the chat box → the conversation is gone. Idempotent, and deliberately
    returns 204 even for an unknown id: closing something already expired is
    the expected case, not an error worth surfacing in the UI.
    """
    chat_session.close(thread_id, user_id)
