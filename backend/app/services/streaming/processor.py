import json
import logging
import re
from collections.abc import Callable, Iterable
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk.types import StreamEvent as SDKStreamEvent

from app.services.streaming.types import StreamEvent, StreamEventType
from app.services.tool_handler import ToolHandlerRegistry

logger = logging.getLogger(__name__)

PROMPT_SUGGESTIONS_PATTERN = re.compile(
    r"<prompt_suggestions>\s*(.*?)\s*</prompt_suggestions>",
    re.DOTALL,
)
LOCAL_COMMAND_STDOUT_PATTERN = re.compile(
    r"<local-command-stdout>(.*?)</local-command-stdout>",
    re.DOTALL,
)
# Claude CLI prints "Set model to X\n" when the model is configured;
# strip it so it never reaches the user as assistant text.
SET_MODEL_LINE_PATTERN = re.compile(r"^Set model to [^\r\n]+\r?\n?")


class StreamProcessor:
    def __init__(
        self,
        tool_registry: ToolHandlerRegistry,
        session_handler: Callable[[str, str | None], None] | None = None,
    ) -> None:
        self._tool_registry = tool_registry
        self._session_handler = session_handler
        self.total_cost_usd = 0.0
        self.usage: dict[str, Any] | None = None
        # Tracks which block kinds have been streamed via partial deltas
        # so we skip only those specific kinds from the complete AssistantMessage.
        self._streamed_kinds: set[str] = set()
        # Buffer to detect and strip "Set model to X\n" at the start of a
        # streaming response before any text reaches the client.
        self._prefix_buf: str = ""
        self._prefix_decided: bool = False

    def _process_session_init(self, message: SystemMessage) -> Iterable[StreamEvent]:
        if message.subtype != "init" or not self._session_handler:
            return

        session_id = message.data.get("session_id")
        if session_id:
            cwd = message.data.get("cwd")
            self._session_handler(session_id, cwd)
            if cwd:
                yield StreamEvent(type="system", data={"worktree_cwd": cwd})

    def emit_events_for_message(
        self,
        message: (
            AssistantMessage
            | UserMessage
            | ResultMessage
            | SystemMessage
            | SDKStreamEvent
        ),
    ) -> Iterable[StreamEvent]:
        if isinstance(message, SDKStreamEvent):
            yield from self._emit_partial_delta(message)
            return

        if isinstance(message, SystemMessage):
            yield from self._process_session_init(message)
            return

        if isinstance(message, AssistantMessage):
            is_subagent = getattr(message, "parent_tool_use_id", None) is not None
            if message.usage is not None and not is_subagent:
                self.usage = message.usage
            yield from self._emit_assistant_events(message)
            self._streamed_kinds.clear()
            self._prefix_buf = ""
            self._prefix_decided = False
            return

        if isinstance(message, UserMessage):
            text = self._extract_command_stdout(message.content)
            if text is not None:
                yield from self._emit_text_block(text, event_type="assistant_text")
            else:
                yield from self._emit_user_events(message.content)
            return

        if isinstance(message, ResultMessage):
            if message.total_cost_usd is not None:
                self.total_cost_usd = message.total_cost_usd
            # Use ResultMessage usage when we have no per-turn usage from
            # AssistantMessage, or when AssistantMessage reported zero input
            # tokens (bridge providers like OpenAI/OpenRouter only include
            # real usage at stream end, not in per-turn messages).
            if message.usage is not None:
                existing_input = (
                    (
                        self.usage.get("input_tokens", 0)
                        + self.usage.get("cache_creation_input_tokens", 0)
                        + self.usage.get("cache_read_input_tokens", 0)
                    )
                    if self.usage
                    else 0
                )
                if existing_input == 0:
                    self.usage = message.usage

    @staticmethod
    def _extract_command_stdout(content: str | list[Any]) -> str | None:
        if not isinstance(content, str):
            return None
        match = LOCAL_COMMAND_STDOUT_PATTERN.search(content)
        return match.group(1).strip() if match else None

    def _emit_assistant_events(
        self, message: AssistantMessage
    ) -> Iterable[StreamEvent]:
        parent_tool_use_id = getattr(message, "parent_tool_use_id", None)
        for block in message.content:
            yield from self._emit_block_events(block, parent_tool_use_id)

    def _emit_partial_delta(self, message: SDKStreamEvent) -> Iterable[StreamEvent]:
        raw = message.event
        if raw.get("type") != "content_block_delta":
            return

        delta = raw.get("delta", {})
        delta_type = delta.get("type")
        if delta_type == "text_delta":
            text = delta.get("text", "")
            if text:
                if not self._prefix_decided:
                    self._prefix_buf += text
                    # Wait until we have a newline or enough chars to decide.
                    if "\n" not in self._prefix_buf and len(self._prefix_buf) <= 60:
                        return
                    self._prefix_decided = True
                    match = SET_MODEL_LINE_PATTERN.match(self._prefix_buf)
                    text = self._prefix_buf[match.end():] if match else self._prefix_buf
                    self._prefix_buf = ""
                    if not text:
                        return
                self._streamed_kinds.add("text")
                yield {"type": "assistant_text", "text": text}
        elif delta_type == "thinking_delta":
            thinking = delta.get("thinking", "")
            if thinking:
                self._streamed_kinds.add("thinking")
                yield {"type": "assistant_thinking", "thinking": thinking}

    def _emit_block_events(
        self, block: Any, parent_tool_use_id: str | None = None
    ) -> Iterable[StreamEvent]:
        if isinstance(block, TextBlock):
            if "text" in self._streamed_kinds:
                # Text already streamed token-by-token via partial deltas,
                # but we still need to extract prompt suggestions from the
                # complete text since the tag spans multiple delta chunks.
                yield from self._extract_prompt_suggestions(block.text)
            else:
                yield from self._emit_text_block(
                    block.text, event_type="assistant_text"
                )
            return

        if isinstance(block, ThinkingBlock):
            if "thinking" not in self._streamed_kinds:
                yield from self._emit_thinking_block(block.thinking)
            return

        if isinstance(block, ToolUseBlock):
            yield from self._emit_tool_start(block, parent_tool_use_id)
            return

        if isinstance(block, ToolResultBlock):
            yield from self._emit_tool_result(block)

    def _emit_user_events(self, content: Any) -> Iterable[StreamEvent]:
        if not content:
            return

        if isinstance(content, list):
            for item in content:
                yield from self._emit_user_item_event(item)
            return

        if isinstance(content, str):
            yield from self._emit_text_block(content, event_type="user_text")
            return

        yield from self._emit_text_block(str(content), event_type="user_text")

    def _emit_user_item_event(self, item: Any) -> Iterable[StreamEvent]:
        if isinstance(item, TextBlock):
            yield from self._emit_text_block(item.text, event_type="user_text")
            return

        if isinstance(item, ToolResultBlock):
            yield from self._emit_tool_result(item)

    def _extract_prompt_suggestions(self, text: str) -> Iterable[StreamEvent]:
        match = PROMPT_SUGGESTIONS_PATTERN.search(text)
        if not match:
            return
        try:
            parsed = json.loads(match.group(1))
            if isinstance(parsed, list):
                suggestions = [
                    s.strip() for s in parsed if isinstance(s, str) and s.strip()
                ]
                if suggestions:
                    yield {
                        "type": "prompt_suggestions",
                        "suggestions": suggestions,
                    }
            else:
                logger.warning("Prompt suggestions is not a list")
        except json.JSONDecodeError:
            logger.warning("Failed to parse prompt suggestions JSON")

    def _emit_text_block(
        self, text: str | None, *, event_type: StreamEventType
    ) -> Iterable[StreamEvent]:
        if not text:
            return

        if event_type == "assistant_text":
            text = SET_MODEL_LINE_PATTERN.sub("", text, count=1).lstrip("\n")
            if not text:
                return

        if event_type == "assistant_text" and PROMPT_SUGGESTIONS_PATTERN.search(text):
            cleaned = PROMPT_SUGGESTIONS_PATTERN.sub("", text).strip()
            if cleaned:
                yield {"type": event_type, "text": cleaned}
            yield from self._extract_prompt_suggestions(text)
            return

        yield {"type": event_type, "text": text}

    def _emit_thinking_block(self, thinking: str | None) -> Iterable[StreamEvent]:
        if thinking:
            event: StreamEvent = {
                "type": "assistant_thinking",
                "thinking": thinking,
            }
            yield event

    def _emit_tool_start(
        self, block: ToolUseBlock, parent_tool_use_id: str | None
    ) -> Iterable[StreamEvent]:
        parent_tool_id = parent_tool_use_id or getattr(
            block, "parent_tool_use_id", None
        )
        tool_event = self._tool_registry.start_tool(
            block, parent_tool_id=parent_tool_id
        )
        if tool_event:
            yield tool_event

    def _emit_tool_result(self, block: ToolResultBlock) -> Iterable[StreamEvent]:
        tool_event = self._tool_registry.finish_tool(
            block.tool_use_id,
            block.content,
            is_error=getattr(block, "is_error", False),
        )
        if tool_event:
            yield tool_event
