import json
import logging
import re
from collections.abc import Callable, Iterable
from typing import Any, TypeAlias

from claude_agent_sdk import (
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    AssistantMessage,
    UserMessage,
    ResultMessage,
    ThinkingBlock,
    SystemMessage,
)
from app.services.tool_handler import ToolHandlerRegistry
from app.services.streaming.events import StreamEvent, StreamEventType


logger = logging.getLogger(__name__)

PROMPT_SUGGESTIONS_PATTERN = re.compile(
    r"<prompt_suggestions>\s*(.*?)\s*</prompt_suggestions>",
    re.DOTALL,
)

MessageType: TypeAlias = AssistantMessage | UserMessage | ResultMessage | SystemMessage


class StreamProcessor:
    def __init__(
        self,
        tool_registry: ToolHandlerRegistry,
        session_handler: Callable[[str], None] | None = None,
    ) -> None:
        self._tool_registry = tool_registry
        self._session_handler = session_handler
        self.total_cost_usd = 0.0

    def _process_session_init(self, message: SystemMessage) -> None:
        if message.subtype != "init" or not self._session_handler:
            return

        session_id = message.data.get("session_id")
        if session_id:
            self._session_handler(session_id)

    def emit_events_for_message(self, message: MessageType) -> Iterable[StreamEvent]:
        if isinstance(message, SystemMessage):
            self._process_session_init(message)
            return

        if isinstance(message, AssistantMessage):
            yield from self._emit_assistant_events(message)
            return

        if isinstance(message, UserMessage):
            yield from self._emit_user_events(message.content)
            return

        if isinstance(message, ResultMessage):
            if message.total_cost_usd is not None:
                self.total_cost_usd = message.total_cost_usd

    def _emit_assistant_events(
        self, message: AssistantMessage
    ) -> Iterable[StreamEvent]:
        parent_tool_use_id = getattr(message, "parent_tool_use_id", None)
        for block in message.content:
            yield from self._emit_block_events(block, parent_tool_use_id)

    def _emit_block_events(
        self, block: Any, parent_tool_use_id: str | None = None
    ) -> Iterable[StreamEvent]:
        if isinstance(block, TextBlock):
            yield from self._emit_text_block(block.text, event_type="assistant_text")
            return

        if isinstance(block, ThinkingBlock):
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

    def _emit_text_block(
        self, text: str | None, *, event_type: StreamEventType
    ) -> Iterable[StreamEvent]:
        if not text:
            return

        suggestions: list[str] | None = None

        if event_type == "assistant_text":
            match = PROMPT_SUGGESTIONS_PATTERN.search(text)
            if match:
                try:
                    parsed = json.loads(match.group(1))
                    if isinstance(parsed, list):
                        suggestions = [
                            s.strip()
                            for s in parsed
                            if isinstance(s, str) and s.strip()
                        ]
                        if suggestions:
                            text = PROMPT_SUGGESTIONS_PATTERN.sub("", text).strip()
                    else:
                        logger.warning("Prompt suggestions is not a list")
                except json.JSONDecodeError:
                    logger.warning("Failed to parse prompt suggestions JSON")

        if text:
            event: StreamEvent = {"type": event_type, "text": text}
            yield event

        if suggestions:
            suggestions_event: StreamEvent = {
                "type": "prompt_suggestions",
                "suggestions": suggestions,
            }
            yield suggestions_event


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
        parent_tool_id = self._determine_parent_tool_id(block, parent_tool_use_id)
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

    def _determine_parent_tool_id(
        self, block: ToolUseBlock, default_parent: str | None = None
    ) -> str | None:
        if default_parent:
            return default_parent

        parent_tool_id: str | None = getattr(block, "parent_tool_use_id", None)
        if parent_tool_id:
            return parent_tool_id

        return None
