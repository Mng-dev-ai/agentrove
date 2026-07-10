from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Any, Literal, TypedDict
from uuid import UUID

from app.models.types import PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME


StreamEventType = Literal[
    "assistant_text",
    "assistant_thinking",
    "tool_started",
    "tool_completed",
    "tool_failed",
    "user_text",
    "system",
    "permission_request",
    "prompt_suggestions",
    "usage",
    "plan",
]
MAX_AUDIT_STRING_LENGTH = 4096
# The agent embeds prompt suggestions as an XML tag at the end of its response.
# This regex extracts them so they can be sent as a structured event and stripped
# from the visible assistant text.
PROMPT_SUGGESTIONS_RE = re.compile(
    r"<prompt_suggestions>\s*(.*?)\s*</prompt_suggestions>",
    re.DOTALL,
)
SENSITIVE_KEY_PARTS = (
    "token",
    "api_key",
    "secret",
    "password",
    "authorization",
    "cookie",
)


@dataclass(kw_only=True)
class ChatStreamRequest:
    prompt: str
    system_prompt: str
    custom_instructions: str | None
    chat_data: dict[str, Any]
    model_id: str
    permission_mode: PermissionMode
    session_id: str | None
    assistant_message_id: str | None
    thinking_mode: str | None
    worktree: bool = False
    attachments: list[dict[str, Any]] | None
    context_window: int | None = None
    selected_persona_name: str = DEFAULT_PERSONA_NAME


class ToolPayload(TypedDict, total=False):
    id: str
    name: str
    title: str
    status: Literal["started", "completed", "failed"]
    parent_id: str | None
    input: dict[str, Any] | None
    result: Any
    error: str
    permission_mode: PermissionMode


class StreamEvent(TypedDict, total=False):
    type: StreamEventType
    text: str
    thinking: str
    tool: ToolPayload
    data: dict[str, Any]
    request_id: str
    tool_name: str
    tool_input: dict[str, Any]
    suggestions: list[str]


# Accumulates stream events during a generation so the runtime can persist
# a complete snapshot to DB periodically (for SSE reconnection catch-up)
# without replaying the entire event history each time.
@dataclass
class StreamSnapshotAccumulator:
    events: list[dict[str, Any]] = field(default_factory=list)
    text_parts: list[str] = field(default_factory=list)

    def add_event(self, kind: str, payload: dict[str, Any]) -> None:
        if kind == "assistant_text":
            text = payload.get("text")
            if isinstance(text, str) and text:
                self.text_parts.append(text)

        self.events.append({"type": kind, **payload})

    def to_render(self) -> dict[str, Any]:
        return {"events": self.events}

    @property
    def content_text(self) -> str:
        raw = "".join(self.text_parts)
        if "<prompt_suggestions>" not in raw:
            return raw
        return PROMPT_SUGGESTIONS_RE.sub("", raw).strip()


class StreamEnvelope:
    @staticmethod
    def build(
        *,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        seq: int,
        kind: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "chatId": str(chat_id),
            "messageId": str(message_id),
            "streamId": str(stream_id),
            "seq": seq,
            "kind": kind,
            "payload": payload or {},
        }

    @staticmethod
    def serialize(
        *,
        chat_id: UUID,
        message_id: UUID,
        stream_id: UUID,
        seq: int,
        kind: str,
        payload: dict[str, Any] | None = None,
    ) -> str:
        return json.dumps(
            StreamEnvelope.build(
                chat_id=chat_id,
                message_id=message_id,
                stream_id=stream_id,
                seq=seq,
                kind=kind,
                payload=payload,
            ),
            ensure_ascii=False,
        )

    @staticmethod
    def sanitize_payload(value: Any) -> Any:
        # Recursively redact sensitive keys (tokens, passwords) and truncate
        # long strings with a sha256 hash for traceability. Used to build the
        # audit_payload stored alongside the render_payload in message_events.
        if isinstance(value, dict):
            redacted: dict[str, Any] = {}
            for key, nested in value.items():
                lower = key.lower()
                if any(part in lower for part in SENSITIVE_KEY_PARTS):
                    redacted[key] = "[REDACTED]"
                    continue
                redacted[key] = StreamEnvelope.sanitize_payload(nested)
            return redacted

        if isinstance(value, list):
            return [StreamEnvelope.sanitize_payload(item) for item in value]

        if isinstance(value, (bytes, bytearray, memoryview)):
            return "[BINARY_OMITTED]"

        if isinstance(value, str):
            if len(value) > MAX_AUDIT_STRING_LENGTH:
                digest = sha256(value.encode("utf-8", errors="ignore")).hexdigest()
                return {
                    "value": value[:MAX_AUDIT_STRING_LENGTH],
                    "truncated": True,
                    "sha256": digest,
                    "original_length": len(value),
                }
            return value

        if isinstance(value, (int, float, bool)) or value is None:
            return value

        return str(value)
