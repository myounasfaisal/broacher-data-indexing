"""
Agent loops for the chat assistant — one per wire format.

THREE PROVIDER OPTIONS, TWO IMPLEMENTATIONS. `CHAT_PROVIDER` selects
"anthropic" | "gpt" | "qwen", but Qwen's DashScope endpoint speaks the OpenAI
chat-completions protocol (the extraction path already drives it through the
`openai` SDK), so "gpt" and "qwen" share `OpenAICompatProvider` and differ only
by base URL, key and model name. Anthropic gets its own loop because its
tool-use format is genuinely different:

    Anthropic                          OpenAI / Qwen
    ---------                          -------------
    system= top-level parameter        {"role": "system"} message
    tools[].input_schema               tools[].function.parameters
    stop_reason == "tool_use"          message.tool_calls
    content block {"type":"tool_use"}  tool_call.function.{name,arguments}
    user turn of tool_result blocks    one {"role":"tool"} message per call
    input .input is a parsed dict      .arguments is a JSON *string*

Both loops share the tool registry in agent_tools.py, both cap iterations, and
both return the same ChatResult — so the router, the prompt and the citation
validator are provider-agnostic.

PROGRESS EVENTS vs TOKEN STREAMING — these are different things and only one
is implemented. Token streaming (rendering the answer word by word) would need
per-provider delta normalisation and is still deferred. Progress events are
provider-agnostic: both loops already know when a turn starts and which tools
they are about to run, so an `on_event` callback costs one hook per loop and
lets the UI say what is ACTUALLY happening ("searching the catalog for 'epoxy
hardener'") rather than cycling invented labels past a spinner.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

import anthropic
from openai import OpenAI

from app.config import eff_int, eff_str
from app.services import agent_tools, extraction, llm_clients

logger = logging.getLogger(__name__)


class ChatProviderError(Exception):
    """The provider call failed or returned something unusable."""


@dataclass
class ChatResult:
    """What every loop returns, whatever protocol it spoke."""

    text: str
    # Tool calls made this turn, for the audit row: [{"name":…, "arguments":…}]
    trace: list[dict[str, Any]] = field(default_factory=list)
    # Every listing id that appeared in a tool RESULT this turn. The citation
    # allowlist — anything the model cites outside this set is hallucinated.
    seen_listing_ids: set[str] = field(default_factory=set)
    # Provider's own history entries for this turn, appended to the thread so
    # the next turn has the assistant's reply in context. Tool traffic is NOT
    # kept: it is large, and the answer text already carries what mattered.
    assistant_message: dict[str, Any] = field(default_factory=dict)


# A progress sink. Called from the provider's own thread with small dicts:
#   {"type": "thinking"}                                  — model call started
#   {"type": "tool", "name": ..., "detail": "epoxy"}      — about to run a tool
#   {"type": "tool_done", "name": ..., "count": 12}       — tool returned
# Never load-bearing: a failure to emit must not affect the answer.
ProgressFn = Callable[[dict[str, Any]], None]


def _noop(_: dict[str, Any]) -> None:
    return None


def _tool_detail(arguments: dict[str, Any]) -> str:
    """
    The most human-readable argument, for the UI's status line. Falls back to
    empty rather than dumping raw JSON at the user.
    """
    for key in (
        "query",
        "details_query",
        "chemical_name",
        "cas_number",
        "supplier",
        "chemical_id",
    ):
        value = arguments.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:60]
    return ""


def _done_event(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """
    A finished tool call, for the UI.

    `failed` matters: without it a tool that ERRORED and a search that
    legitimately found nothing both render as "0 results", so a broken lookup
    looks like an empty catalog. That ambiguity hid a real bug during testing.
    """
    return {
        "type": "tool_done",
        "name": name,
        "count": payload.get("returned", 0),
        "failed": bool(payload.get("error")) and not payload.get("duplicate"),
        "duplicate": bool(payload.get("duplicate")),
    }


class ChatProvider(Protocol):
    def run(
        self,
        system: str,
        messages: list[dict[str, Any]],
        on_event: ProgressFn = ...,
    ) -> ChatResult: ...


# ---------------------------------------------------------------------------
# Anthropic
# ---------------------------------------------------------------------------

_get_anthropic = llm_clients.anthropic_client

# The adaptive-thinking `effort` dial only exists on the Claude 5 tier
# (Sonnet 5, Opus 5) — Haiku 4.5 and every Claude 4.x model reject the
# parameter outright (400 invalid_request_error). Checked by prefix, not
# equality, so a dated snapshot of the same model still matches.
_EFFORT_CAPABLE_PREFIXES = ("claude-sonnet-5", "claude-opus-5")


def _supports_effort(model: str) -> bool:
    return model.startswith(_EFFORT_CAPABLE_PREFIXES)


class AnthropicChatProvider:
    """
    Sonnet 5 agent loop.

    Model-specific constraints handled here:
      * No `temperature` / `top_p` / `top_k` — non-default values are rejected.
        Tone is steered by the prompt only.
      * No assistant-turn prefill.
      * No mid-conversation {"role":"system"} messages — Sonnet 5 rejects them,
        which is why Inspector context is injected into the USER turn upstream
        (see chat_agent.build_user_turn).
      * Adaptive thinking is on by default; `effort` is the cost dial. Sonnet 5
        defaults to "high", more than a short-answer chat needs.
      * Minimum cacheable prefix is 1024 tokens. `cache_control` on the last
        tool definition covers tools + system (tools render first); if the
        prefix is under 1024 tokens caching silently no-ops, which is a
        non-event — correctness does not depend on it.
    """

    def run(
        self,
        system: str,
        messages: list[dict[str, Any]],
        on_event: ProgressFn = _noop,
    ) -> ChatResult:
        client = _get_anthropic()
        tools = agent_tools.anthropic_schema()
        # Cache the stable prefix (tools + system). Both are byte-identical
        # across every request, so this is the whole win available here.
        tools[-1] = {**tools[-1], "cache_control": {"type": "ephemeral"}}

        history = list(messages)
        result = ChatResult(text="")
        guard = agent_tools.CallGuard()

        for _ in range(eff_int("chat_max_tool_iterations")):
            on_event({"type": "thinking"})
            model = eff_str("chat_anthropic_model")
            kwargs: dict[str, Any] = dict(
                model=model,
                max_tokens=2048,
                system=system,
                tools=tools,
                messages=history,
            )
            if _supports_effort(model):
                kwargs["output_config"] = {"effort": eff_str("chat_effort")}
            try:
                response = client.messages.create(**kwargs)
            except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
                message, _fatal = extraction.friendly_provider_error(exc, "the chat assistant")
                raise ChatProviderError(message) from exc

            # Check stop_reason BEFORE reading content: on a refusal the
            # content array is empty (or partial) and indexing it would blow up.
            if response.stop_reason == "refusal":
                raise ChatProviderError(
                    "The assistant declined to answer that request."
                )

            text = "".join(
                b.text for b in response.content if getattr(b, "type", "") == "text"
            )
            tool_uses = [b for b in response.content if getattr(b, "type", "") == "tool_use"]

            if not tool_uses:
                result.text = text.strip()
                result.assistant_message = {"role": "assistant", "content": text}
                return result

            # Echo the assistant turn back verbatim — the tool_use blocks must
            # survive intact or the follow-up tool_result won't bind to them.
            history.append({"role": "assistant", "content": response.content})

            tool_results = []
            for block in tool_uses:
                # Anthropic hands us a parsed dict, unlike OpenAI's JSON string.
                args = dict(block.input or {})
                on_event(
                    {
                        "type": "tool",
                        "name": block.name,
                        "detail": _tool_detail(args),
                    }
                )
                payload = agent_tools.execute(block.name, args, guard)
                on_event(_done_event(block.name, payload))
                result.trace.append({"name": block.name, "arguments": block.input})
                result.seen_listing_ids |= agent_tools.collect_listing_ids(payload)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(payload, default=str),
                        "is_error": bool(payload.get("error")),
                    }
                )
            # All results for one assistant turn go back in ONE user message.
            history.append({"role": "user", "content": tool_results})

        raise ChatProviderError(
            "The assistant kept searching without reaching an answer."
        )


# ---------------------------------------------------------------------------
# OpenAI-compatible (GPT and Qwen)
# ---------------------------------------------------------------------------

def _get_openai_compat(flavour: str) -> tuple[OpenAI, str]:
    """
    Returns (client, model) for "gpt" or "qwen". The two never share a client —
    different keys and base URLs — and both come from llm_clients, so a key
    saved in Settings applies to the next message without a restart.
    """
    if flavour == "qwen":
        return llm_clients.qwen_client(), eff_str("chat_qwen_model")
    return llm_clients.openai_client(), eff_str("chat_gpt_model")


class OpenAICompatProvider:
    """
    Chat-completions agent loop, used for both GPT and Qwen.

    The only differences between the two are the client and the model name, so
    they are one class with a `flavour` — duplicating the loop would mean two
    places to fix every tool-protocol bug.
    """

    def __init__(self, flavour: str) -> None:
        self.flavour = flavour

    def run(
        self,
        system: str,
        messages: list[dict[str, Any]],
        on_event: ProgressFn = _noop,
    ) -> ChatResult:
        client, model = _get_openai_compat(self.flavour)
        tools = agent_tools.openai_schema()

        # System prompt is a message here, not a top-level parameter.
        history: list[dict[str, Any]] = [{"role": "system", "content": system}]
        history.extend(messages)
        result = ChatResult(text="")
        guard = agent_tools.CallGuard()

        for _ in range(eff_int("chat_max_tool_iterations")):
            on_event({"type": "thinking"})
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=history,
                    tools=tools,
                    max_tokens=2048,
                )
            except Exception as exc:  # noqa: BLE001 - SDK raises a wide range
                message, _fatal = extraction.friendly_provider_error(exc, "the chat assistant")
                raise ChatProviderError(message) from exc

            if not response.choices:
                raise ChatProviderError(f"{self.flavour} returned no choices.")

            message = response.choices[0].message
            tool_calls = list(message.tool_calls or [])

            if not tool_calls:
                text = (message.content or "").strip()
                result.text = text
                result.assistant_message = {"role": "assistant", "content": text}
                return result

            history.append(
                {
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": c.id,
                            "type": "function",
                            "function": {
                                "name": c.function.name,
                                "arguments": c.function.arguments,
                            },
                        }
                        for c in tool_calls
                    ],
                }
            )

            for call in tool_calls:
                # Arguments arrive as a JSON *string* here (Anthropic gives a
                # dict). Malformed JSON is a model error, not a crash — hand it
                # back so it can retry with valid arguments.
                try:
                    args = json.loads(call.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                    payload: dict[str, Any] = {
                        "error": "Arguments were not valid JSON."
                    }
                else:
                    on_event(
                        {
                            "type": "tool",
                            "name": call.function.name,
                            "detail": _tool_detail(args),
                        }
                    )
                    payload = agent_tools.execute(call.function.name, args, guard)
                    on_event(_done_event(call.function.name, payload))

                result.trace.append({"name": call.function.name, "arguments": args})
                result.seen_listing_ids |= agent_tools.collect_listing_ids(payload)
                # One message per call, unlike Anthropic's single batched turn.
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": json.dumps(payload, default=str),
                    }
                )

        raise ChatProviderError(
            "The assistant kept searching without reaching an answer."
        )


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def get_provider() -> ChatProvider:
    """The single active provider for this deployment. Not a fallback chain."""
    name = (eff_str("chat_provider") or "anthropic").lower()
    if name == "anthropic":
        return AnthropicChatProvider()
    if name in ("gpt", "openai"):
        return OpenAICompatProvider("gpt")
    if name == "qwen":
        return OpenAICompatProvider("qwen")
    raise ChatProviderError(
        f"Unknown CHAT_PROVIDER '{name}'. Use 'anthropic', 'gpt', or 'qwen'."
    )
