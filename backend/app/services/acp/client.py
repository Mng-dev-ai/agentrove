from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Literal, cast

from acp.schema import (
    AgentMessageChunk,
    AgentPlanUpdate,
    AgentThoughtChunk,
    AllowedOutcome,
    CreateTerminalResponse,
    DeniedOutcome,
    KillTerminalResponse,
    PermissionOption,
    ReadTextFileResponse,
    ReleaseTerminalResponse,
    RequestPermissionResponse,
    SessionInfoUpdate,
    TerminalOutputResponse,
    ToolCallProgress,
    ToolCallStart,
    ToolCallUpdate,
    UsageUpdate,
    UserMessageChunk,
    WaitForTerminalExitResponse,
    WriteTextFileResponse,
)

from app.models.types import PermissionMode
from app.models.db_models.enums import ToolStatus
from app.services.acp.adapters import AgentKind
from app.services.streaming.types import StreamEvent, StreamEventType, ToolPayload

logger = logging.getLogger(__name__)

# Placed on event_queue to signal that the ACP prompt has finished
# (either completed or errored) so consumers know to stop reading.
_SENTINEL = object()

# Valid ACP option_ids that match our PermissionMode literals directly.
VALID_PERMISSION_MODES: set[str] = {
    "default",
    "acceptEdits",
    "plan",
    "build",
    "bypassPermissions",
    "agent",
    "autopilot",
    "auto",
    "read-only",
    "full-access",
    "ask",
}

# Normalizes human-readable option names (e.g. "Accept Edits") to our
# PermissionMode literals when the option_id doesn't match directly.
PERMISSION_MODE_BY_OPTION_NAME: dict[str, PermissionMode] = {
    "default": "default",
    "accept edits": "acceptEdits",
    "plan": "plan",
    "build": "build",
    "agent": "agent",
    "bypass permissions": "bypassPermissions",
    "autopilot": "autopilot",
    "auto": "auto",
    "read only": "read-only",
    "full access": "full-access",
}

# Grok delivers its ask_user_question tool as an ACP extension request
# (`_x.ai/ask_user_question`; the SDK strips the leading underscore). It must
# be answered with an AskUserQuestionExtResponse — an empty result fails the
# tool with "missing field `outcome`".
GROK_ASK_USER_QUESTION_METHOD = "x.ai/ask_user_question"


class AcpClientHandler:
    # Implements the ACP client-side handler interface. The ACP SDK calls
    # methods on this class as the agent emits events (text chunks, tool calls,
    # permission requests, usage updates). Each method translates the ACP event
    # into a StreamEvent and enqueues it for the SSE layer to forward to the frontend.

    def __init__(self, agent_kind: AgentKind) -> None:
        self.agent_kind = agent_kind
        self.event_queue: asyncio.Queue[StreamEvent | object] = asyncio.Queue()
        self._active_tools: dict[str, ToolPayload] = {}
        self._pending_permissions: dict[str, asyncio.Future[str]] = {}
        # Tracks which permission mode the user selected for each tool call,
        # so we can include it in the tool_completed/tool_failed event.
        self._resolved_permissions: dict[str, PermissionMode | None] = {}
        # Maps request_id → {option_id → permission_mode} so resolve_permission
        # can look up the mode that request_permission already derived.
        self._permission_option_modes: dict[str, dict[str, PermissionMode | None]] = {}
        self.total_cost_usd: float = 0.0
        self.usage: dict[str, int] | None = None
        # Set to True during load_session to suppress replayed history events.
        self.muted: bool = False

    # Required by ACP Client protocol interface
    def on_connect(self, conn: Any) -> None:
        pass

    def prepare_for_prompt(self) -> None:
        # Drain any stale events/sentinels left from a previous prompt whose
        # stream consumer was force-closed (e.g., via aclose() after ACP cancel).
        while True:
            try:
                self.event_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    def finish(self, *, prompt_completed: bool) -> None:
        if self._active_tools:
            if prompt_completed:
                terminal_status: Literal["completed", "failed"] = (
                    ToolStatus.COMPLETED.value
                )
                terminal_event_type: StreamEventType = "tool_completed"
            else:
                terminal_status = ToolStatus.FAILED.value
                terminal_event_type = "tool_failed"
            for payload in self._active_tools.values():
                payload["status"] = terminal_status
                if not prompt_completed and "error" not in payload:
                    # Codex occasionally ends the turn without a terminal tool
                    # progress update. Mark the tool as interrupted so the UI
                    # does not leave it stuck in a perpetual loading state.
                    payload["error"] = "Tool ended before a terminal ACP update arrived"
                self.event_queue.put_nowait(
                    StreamEvent(type=terminal_event_type, tool=payload)
                )
            self._active_tools.clear()
        self._resolved_permissions.clear()
        self._permission_option_modes.clear()
        self.event_queue.put_nowait(_SENTINEL)

    def cancel_pending_permissions(self) -> None:
        for future in self._pending_permissions.values():
            if not future.done():
                future.cancel()
        self._pending_permissions.clear()

    @staticmethod
    def is_sentinel(obj: Any) -> bool:
        return obj is _SENTINEL

    async def session_update(
        self,
        session_id: str,
        update: Any,
        **kwargs: Any,
    ) -> None:
        if self.muted:
            return
        event = self._map_update(update)
        if event is not None:
            if isinstance(update, SessionInfoUpdate) and session_id:
                data = event.get("data")
                if isinstance(data, dict):
                    data.setdefault("session_id", session_id)
            self.event_queue.put_nowait(event)

    async def request_permission(
        self,
        options: list[PermissionOption],
        session_id: str,
        tool_call: ToolCallUpdate,
        **kwargs: Any,
    ) -> RequestPermissionResponse:
        # Called by the ACP SDK when the agent wants to perform a gated action
        # (file write, shell command, etc.). We forward the options to the
        # frontend as a permission_request event and block until the user responds.
        request_id = tool_call.tool_call_id
        tool_name = self._extract_tool_name(tool_call)
        tool_input = self._extract_raw_input(tool_call.raw_input)

        option_dicts = []
        for opt in options:
            option_id: str = getattr(opt, "option_id", getattr(opt, "optionId", ""))
            permission_mode: PermissionMode | None = (
                cast(PermissionMode, option_id)
                if option_id in VALID_PERMISSION_MODES
                else None
            )
            if permission_mode is None:
                permission_mode = PERMISSION_MODE_BY_OPTION_NAME.get(
                    opt.name.strip().lower()
                )
            option_dicts.append(
                {
                    "kind": opt.kind,
                    "name": opt.name,
                    "option_id": option_id,
                    "permission_mode": permission_mode,
                }
            )

        self._permission_option_modes[request_id] = {
            od["option_id"]: od["permission_mode"] for od in option_dicts
        }

        event = StreamEvent(
            type="permission_request",
            request_id=request_id,
            tool_name=tool_name,
            tool_input=tool_input or {},
            data={"options": option_dicts},
        )
        self.event_queue.put_nowait(event)

        option_id = await self._wait_for_user_choice(request_id)
        if option_id:
            return RequestPermissionResponse(
                outcome=AllowedOutcome(outcome="selected", option_id=option_id)
            )
        return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))

    async def _wait_for_user_choice(self, request_id: str) -> str:
        # Blocks until resolve_permission() delivers the user's selection for
        # this request; empty string means the user cancelled/dismissed.
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._pending_permissions[request_id] = future
        try:
            return await future
        finally:
            self._pending_permissions.pop(request_id, None)

    def resolve_permission(
        self,
        request_id: str,
        *,
        option_id: str = "",
    ) -> bool:
        # Called from the SSE endpoint when the user responds to a permission
        # request or user question. Unblocks the matching _wait_for_user_choice()
        # awaiter; an empty option_id means the request was cancelled.
        future = self._pending_permissions.get(request_id)
        if future is None or future.done():
            return False

        if option_id:
            option_modes = self._permission_option_modes.pop(request_id, {})
            self._resolved_permissions[request_id] = option_modes.get(option_id)
        else:
            self._permission_option_modes.pop(request_id, None)

        future.set_result(option_id)
        return True

    async def read_text_file(
        self,
        path: str,
        session_id: str,
        limit: int | None = None,
        line: int | None = None,
        **kwargs: Any,
    ) -> ReadTextFileResponse:
        # ACP protocol stubs — the agent binary handles file I/O and terminal
        # operations internally. These no-op implementations satisfy the ACP
        # client interface contract without duplicating sandbox logic here.
        return ReadTextFileResponse(content="", line_count=0)

    async def write_text_file(
        self,
        content: str,
        path: str,
        session_id: str,
        **kwargs: Any,
    ) -> WriteTextFileResponse | None:
        return WriteTextFileResponse()

    async def create_terminal(
        self,
        command: str,
        session_id: str,
        args: list[str] | None = None,
        cwd: str | None = None,
        env: Any = None,
        output_byte_limit: int | None = None,
        **kwargs: Any,
    ) -> CreateTerminalResponse:
        return CreateTerminalResponse(terminal_id="stub")

    async def terminal_output(
        self,
        session_id: str,
        terminal_id: str,
        **kwargs: Any,
    ) -> TerminalOutputResponse:
        # truncated is required by the ACP schema — omitting it makes the
        # response fail validation and aborts the agent's whole turn.
        return TerminalOutputResponse(output="", truncated=False)

    async def release_terminal(
        self,
        session_id: str,
        terminal_id: str,
        **kwargs: Any,
    ) -> ReleaseTerminalResponse | None:
        return ReleaseTerminalResponse()

    async def wait_for_terminal_exit(
        self,
        session_id: str,
        terminal_id: str,
        **kwargs: Any,
    ) -> WaitForTerminalExitResponse:
        return WaitForTerminalExitResponse(exit_code=0)

    async def kill_terminal(
        self,
        session_id: str,
        terminal_id: str,
        **kwargs: Any,
    ) -> KillTerminalResponse | None:
        return KillTerminalResponse()

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if method == GROK_ASK_USER_QUESTION_METHOD:
            return await self._answer_user_question(params)
        return {}

    async def _answer_user_question(self, params: dict[str, Any]) -> dict[str, Any]:
        # Reuses the permission round trip: each question is forwarded as a
        # permission_request whose options are the question's choices, so the
        # existing approval UI collects the answer. Questions go one at a time
        # since the UI shows a single pending request.
        tool_call_id = params.get("toolCallId", "")
        answers: dict[str, str] = {}
        for index, question in enumerate(params.get("questions") or []):
            question_text = question.get("question", "")
            option_dicts = [
                {
                    "kind": "allow_once",
                    "name": opt.get("label", ""),
                    "option_id": opt.get("label", ""),
                    "permission_mode": None,
                }
                for opt in question.get("options") or []
            ]
            request_id = f"{tool_call_id}:q{index}"
            self.event_queue.put_nowait(
                StreamEvent(
                    type="permission_request",
                    request_id=request_id,
                    tool_name="AskUserQuestion",
                    tool_input={"question": question_text},
                    data={"options": option_dicts},
                )
            )
            selected = await self._wait_for_user_choice(request_id)
            if not selected:
                # User dismissed the question — tell Grok to stop interviewing
                # and proceed with whatever answers it already has.
                return {"outcome": "skip_interview"}
            answers[question_text] = selected
        # The wire format accepts string-or-list answer values; we always send
        # a single label (multiSelect degrades to picking one option).
        return {"outcome": "accepted", "answers": answers}

    async def ext_notification(self, method: str, params: dict[str, Any]) -> None:
        pass

    def _map_update(self, update: Any) -> StreamEvent | None:
        if isinstance(update, AgentMessageChunk):
            return self._map_agent_message(update)
        if isinstance(update, AgentThoughtChunk):
            return self._map_agent_thought(update)
        if isinstance(update, ToolCallStart):
            return self._map_tool_call_start(update)
        if isinstance(update, (ToolCallProgress, ToolCallUpdate)):
            return self._map_tool_call_progress(update)
        if isinstance(update, UsageUpdate):
            return self._map_usage_update(update)
        if isinstance(update, UserMessageChunk):
            return self._map_user_message(update)
        if isinstance(update, SessionInfoUpdate):
            return self._map_session_info(update)
        if isinstance(update, AgentPlanUpdate):
            return self._map_plan(update)
        logger.debug("Unhandled ACP update type: %s", type(update).__name__)
        return None

    def _map_agent_message(self, chunk: AgentMessageChunk) -> StreamEvent | None:
        if chunk.content.type == "text":
            return StreamEvent(type="assistant_text", text=chunk.content.text)
        return None

    def _map_agent_thought(self, chunk: AgentThoughtChunk) -> StreamEvent | None:
        if chunk.content.type == "text":
            return StreamEvent(type="assistant_thinking", thinking=chunk.content.text)
        return None

    def _map_user_message(self, chunk: UserMessageChunk) -> StreamEvent | None:
        if chunk.content.type == "text":
            return StreamEvent(type="user_text", text=chunk.content.text)
        return None

    def _map_tool_call_start(self, tc: ToolCallStart) -> StreamEvent:
        payload = ToolPayload(
            id=tc.tool_call_id,
            name=self._extract_tool_name(tc),
            title=tc.title,
            status=ToolStatus.STARTED.value,
            parent_id=self._extract_parent_tool_id(tc),
            input=self._extract_raw_input(tc.raw_input),
        )
        # Codex attaches edit diffs as content blocks on the initial tool_call
        # (and re-sent tool_call updates), while its terminal tool_call_update
        # carries only a status — capture the diffs here or they're lost.
        diffs = self._extract_content_diffs(tc)
        if diffs:
            payload["result"] = {"diffs": diffs}
        self._active_tools[tc.tool_call_id] = payload
        return StreamEvent(type="tool_started", tool=payload)

    def _map_tool_call_progress(self, tc: ToolCallProgress) -> StreamEvent | None:
        # Handles both in-progress updates and terminal states (completed/failed).
        # ACP may send multiple progress events per tool call — e.g. Codex's
        # fetch tool sends title updates as it navigates pages. We track
        # accumulated state in _active_tools and only re-emit when something changed.
        status = tc.status

        existing = self._active_tools.get(tc.tool_call_id)
        if existing is None and status is None:
            return None

        if existing is None:
            existing = ToolPayload(
                id=tc.tool_call_id,
                name="unknown",
                title="Unknown tool",
                status=ToolStatus.STARTED.value,
                parent_id=self._extract_parent_tool_id(tc),
                input=None,
            )

        changed = False
        if tc.title and tc.title != existing.get("title"):
            existing["title"] = tc.title
            changed = True
        if tc.raw_input is not None:
            parsed_input = self._extract_raw_input(tc.raw_input)
            if parsed_input != existing.get("input"):
                existing["input"] = parsed_input
                changed = True

        if status == "completed":
            self._active_tools.pop(tc.tool_call_id, None)
            existing["status"] = ToolStatus.COMPLETED.value
            result = self._extract_tool_result(tc)
            # Codex edit diffs were captured from earlier tool_call events —
            # don't wipe them when the terminal update carries no result.
            if result is not None or "result" not in existing:
                existing["result"] = result
            selected_mode = self._resolved_permissions.pop(tc.tool_call_id, None)
            if selected_mode is not None:
                existing["permission_mode"] = selected_mode
            return StreamEvent(type="tool_completed", tool=existing)
        if status == "failed":
            self._active_tools.pop(tc.tool_call_id, None)
            existing["status"] = ToolStatus.FAILED.value
            existing["error"] = self._extract_tool_error(tc)
            selected_mode = self._resolved_permissions.pop(tc.tool_call_id, None)
            if selected_mode is not None:
                existing["permission_mode"] = selected_mode
            return StreamEvent(type="tool_failed", tool=existing)

        self._active_tools[tc.tool_call_id] = existing
        # Re-emit tool_started so the frontend can update the loading title
        # when input arrives or title changes.
        if changed:
            return StreamEvent(type="tool_started", tool=existing)
        return None

    def _map_usage_update(self, usage: UsageUpdate) -> StreamEvent | None:
        if usage.cost is not None:
            self.total_cost_usd = usage.cost.amount
        self.usage = {
            "input_tokens": usage.used,
            "context_window": usage.size,
        }
        return StreamEvent(type="usage", data=self.usage)

    def _map_session_info(self, info: SessionInfoUpdate) -> StreamEvent | None:
        # session_id comes from the outer SessionNotification and is injected
        # by session_update(). Always emit so the caller can attach the session_id.
        return StreamEvent(type="system", data={})

    def _map_plan(self, plan: AgentPlanUpdate) -> StreamEvent | None:
        # Claude sends TodoWrite and Task* state only as plan updates. OpenCode
        # also emits todowrite tool calls, so forwarding its plan would duplicate it.
        if self.agent_kind == AgentKind.OPENCODE:
            return None
        # Each ACP plan update carries the complete entry list; the frontend
        # replaces the whole plan rather than appending.
        return StreamEvent(
            type="plan",
            data={
                "entries": [
                    {"content": e.content, "status": e.status, "priority": e.priority}
                    for e in plan.entries
                ]
            },
        )

    @staticmethod
    def _extract_parent_tool_id(tc: Any) -> str | None:
        meta = getattr(tc, "field_meta", None) or {}
        claude_meta = meta.get("claudeCode", {})
        parent_id = claude_meta.get("parentToolUseId")
        if parent_id:
            return str(parent_id)
        return None

    def _extract_tool_name(self, tc: Any) -> str:
        # Claude embeds the tool name in field_meta.claudeCode.toolName (e.g.
        # "Read", "Edit"). OpenCode puts the raw tool name (bash, read, edit,
        # write, grep, glob, webfetch, task, todowrite, skill, question) in
        # `title` — its ACP `kind` collapses distinct tools (edit/write/patch
        # all become "edit"), so title is the only way to distinguish them.
        # Grok puts the raw tool name (write, search_replace, read_file, grep,
        # run_terminal_command, ...) in field_meta["x.ai/tool"].name — its
        # initial tool_call has no `kind` and later updates rewrite `title`
        # to a human label. Web search calls lack that meta, so they fall
        # through to `kind` ("search"). Codex/Copilot/Cursor use the
        # top-level `kind` field.
        meta = getattr(tc, "field_meta", None) or {}
        claude_meta = meta.get("claudeCode", {})
        if tool_name := claude_meta.get("toolName"):
            return str(tool_name)
        if self.agent_kind == AgentKind.OPENCODE:
            if title := getattr(tc, "title", None):
                return str(title)
        if self.agent_kind == AgentKind.GROK:
            if tool_name := meta.get("x.ai/tool", {}).get("name"):
                return str(tool_name)
        kind = getattr(tc, "kind", None)
        if kind:
            return str(kind)
        return str(getattr(tc, "title", None) or "unknown")

    @staticmethod
    def _extract_raw_input(raw_input: Any) -> dict[str, Any] | None:
        if not raw_input:
            return None
        if isinstance(raw_input, dict):
            return raw_input
        try:
            parsed = json.loads(str(raw_input))
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
        return {"raw": str(raw_input)}

    @staticmethod
    def _extract_content_texts(tc: ToolCallProgress) -> list[str]:
        if not tc.content:
            return []
        texts = []
        for block in tc.content:
            inner = getattr(block, "content", None)
            if inner and getattr(inner, "type", None) == "text":
                texts.append(inner.text)
        return texts

    @staticmethod
    def _extract_content_diffs(
        tc: ToolCallStart | ToolCallProgress,
    ) -> list[dict[str, Any]]:
        # Cursor and Codex emit `edit` tool results as ACP FileEditToolCallContent
        # blocks (type="diff") with path/oldText/newText, without raw_output —
        # Cursor on the terminal update, Codex on the initial tool_call.
        # Surface these so the frontend edit renderer can show the diff.
        if not tc.content:
            return []
        diffs: list[dict[str, Any]] = []
        for block in tc.content:
            if getattr(block, "type", None) != "diff":
                continue
            diffs.append(
                {
                    "path": getattr(block, "path", None),
                    "oldText": getattr(block, "old_text", None),
                    "newText": getattr(block, "new_text", None),
                }
            )
        return diffs

    @classmethod
    def _extract_tool_result(cls, tc: ToolCallProgress) -> Any:
        # Claude puts structured results in field_meta.claudeCode.toolResponse,
        # Codex/Cursor put execute/read results in raw_output, and Cursor emits
        # its edit results as diff content blocks instead of raw_output. Content
        # text blocks are the last resort for agents that use none of the above.
        meta = getattr(tc, "field_meta", None) or {}
        claude_meta = meta.get("claudeCode", {})
        if "toolResponse" in claude_meta:
            return claude_meta["toolResponse"]
        if tc.raw_output is not None:
            return tc.raw_output
        diffs = cls._extract_content_diffs(tc)
        if diffs:
            return {"diffs": diffs}
        texts = cls._extract_content_texts(tc)
        return "\n".join(texts) if texts else None

    def _extract_tool_error(self, tc: ToolCallProgress) -> str:
        # Grok's failed updates carry a variant-tag dict in raw_output (e.g.
        # {"type": "FileNotFound"}) while the readable message lives in the
        # content text blocks, so prefer those.
        if self.agent_kind == AgentKind.GROK:
            texts = self._extract_content_texts(tc)
            if texts:
                return "\n".join(texts)
        if tc.raw_output is not None:
            if isinstance(tc.raw_output, dict):
                # Codex wraps the error in formatted_output; opencode uses a
                # top-level `error` string. Fall through to stringifying the
                # dict only if neither is present.
                for key in ("formatted_output", "error"):
                    value = tc.raw_output.get(key)
                    if value:
                        return str(value)
                return str(tc.raw_output)
            return str(tc.raw_output)
        texts = self._extract_content_texts(tc)
        return "\n".join(texts) if texts else "Tool execution failed"
