from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import re
from collections.abc import Callable
from typing import Any, Literal, cast, get_args

from acp.connection import StreamDirection
from acp.connection import StreamEvent as AcpStreamEvent
from acp.schema import (
    AcceptElicitationResponse,
    AgentMessageChunk,
    AgentPlanUpdate,
    AgentThoughtChunk,
    AllowedOutcome,
    CancelElicitationResponse,
    CreateTerminalResponse,
    CreateElicitationResponse,
    CurrentModeUpdate,
    DeclineElicitationResponse,
    DeniedOutcome,
    ElicitationFormRequestMode,
    ElicitationFormSessionMode,
    ElicitationMode,
    ImageContentBlock,
    KillTerminalResponse,
    PermissionOption,
    ReadTextFileResponse,
    ReleaseTerminalResponse,
    RequestPermissionResponse,
    SessionInfoUpdate,
    SessionNotification,
    TerminalOutputResponse,
    ToolCallProgress,
    ToolCallStart,
    ToolCallUpdate,
    UsageUpdate,
    UserMessageChunk,
    WaitForTerminalExitResponse,
    WriteTextFileResponse,
)

from app.models.types import AgentKind, PermissionMode
from app.models.db_models.enums import ToolStatus
from app.services.acp.adapters import AGENT_ADAPTERS
from app.services.streaming.images import tool_image
from app.services.streaming.types import (
    StreamEvent,
    ToolImage,
    ToolPayload,
)

logger = logging.getLogger(__name__)

# Sentinel on event_queue when the ACP prompt finishes (success or error).
_SENTINEL = object()

# claude-agent-acp fixed heartbeat forwarding in 0.63.0; retain the ID filter
# as defense-in-depth for other or older adapters.
_HEARTBEAT_TOOL_ID_RE = re.compile(r"-heartbeat-\d+$")

# Valid ACP option_ids that match our PermissionMode literals directly.
VALID_PERMISSION_MODES: frozenset[str] = frozenset(get_args(PermissionMode))

# claude-agent-acp ExitPlanMode option ids → the mode the agent switches to.
# Its `auto` options stay unmapped: Claude chats have no Auto mode to show.
PERMISSION_MODE_BY_OPTION_ID: dict[str, PermissionMode] = {
    "exit-plan-default": "default",
    "exit-plan-accept-edits": "acceptEdits",
    "exit-plan-clear-accept-edits": "acceptEdits",
    "exit-plan-bypass": "bypassPermissions",
    "exit-plan-clear-bypass": "bypassPermissions",
}

# Human option labels → PermissionMode when option_id isn't already a literal.
PERMISSION_MODE_BY_OPTION_NAME: dict[str, PermissionMode] = {
    "auto edit": "auto_edit",
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
    "always approve": "always-approve",
    "yolo": "yolo",
}

CHANNEL_PERMISSION_TIMEOUT_SECONDS = 300
CHANNEL_ELICITATION_TIMEOUT_SECONDS = 15 * 60


class AcpClientHandler:
    # ACP client handler: SDK events → StreamEvent on event_queue for SSE.

    def __init__(self, agent_kind: AgentKind, *, channel_member: bool = False) -> None:
        self.channel_member = channel_member
        self._adapter = AGENT_ADAPTERS[agent_kind]
        self.event_queue: asyncio.Queue[StreamEvent | object] = asyncio.Queue()
        self._active_tools: dict[str, ToolPayload] = {}
        self._completed_on_start: set[str] = set()
        # Per-connection names the adapter reads from the raw JSON-RPC in
        # observe_stream, keyed by tool call id.
        self._wire_tool_names: dict[str, str] = {}
        self._pending_permissions: dict[str, asyncio.Future[str]] = {}
        self._pending_elicitations: dict[
            str,
            asyncio.Future[
                tuple[Literal["accept", "decline", "cancel"], dict[str, Any] | None]
            ],
        ] = {}
        self._pending_elicitation_payloads: dict[str, dict[str, Any]] = {}
        self._elicitation_counter = 0
        # Permission mode chosen per tool call (for tool_completed/failed events).
        self._resolved_permissions: dict[str, PermissionMode | None] = {}
        # request_id → option_id → permission_mode (filled in request_permission).
        self._permission_option_modes: dict[str, dict[str, PermissionMode | None]] = {}
        self.total_cost_usd: float = 0.0
        self.usage: dict[str, int] | None = None
        # Suppress replayed history events during load_session.
        self.muted: bool = False
        # Set by the owning AcpSession to track modes the agent switches itself.
        self.on_mode_update: Callable[[str], None] = lambda mode_id: None

    def on_connect(self, conn: Any) -> None:
        pass

    def observe_stream(self, event: AcpStreamEvent) -> None:
        # Must stay sync: the SDK runs sync observers inline, ahead of later responses.
        if event.direction is not StreamDirection.INCOMING:
            return
        params = event.message.get("params")
        if not isinstance(params, dict):
            return
        method = event.message.get("method")
        self._capture_wire_tool_name(method, params)
        if method == "session/update":
            notification = SessionNotification.model_validate(params)
            self.apply_session_update(notification.session_id, notification.update)

    def _capture_wire_tool_name(self, method: Any, params: dict[str, Any]) -> None:
        if method == "session/update":
            tool_call = params.get("update")
        elif method == "session/request_permission":
            tool_call = params.get("toolCall")
        else:
            return
        if not isinstance(tool_call, dict):
            return
        tool_call_id = tool_call.get("toolCallId")
        name = self._adapter.wire_tool_name(tool_call)
        if isinstance(tool_call_id, str) and name:
            self._wire_tool_names[tool_call_id] = name

    def prepare_for_prompt(self) -> None:
        # Drain any stale events/sentinels left from a previous prompt whose
        # stream consumer was force-closed (e.g., via aclose() after ACP cancel).
        self.take_unread_events()

    def take_unread_events(self) -> list[StreamEvent]:
        events: list[StreamEvent] = []
        while True:
            try:
                item = self.event_queue.get_nowait()
            except asyncio.QueueEmpty:
                return events
            if not self.is_sentinel(item):
                events.append(cast(StreamEvent, item))

    def finish(self, *, prompt_completed: bool) -> None:
        if self._active_tools:
            for tool_id, payload in self._active_tools.items():
                completed = prompt_completed or tool_id in self._completed_on_start
                payload["status"] = (
                    ToolStatus.COMPLETED.value if completed else ToolStatus.FAILED.value
                )
                if not completed and "error" not in payload:
                    # Codex occasionally ends the turn without a terminal tool
                    # progress update. Mark the tool as interrupted so the UI
                    # does not leave it stuck in a perpetual loading state.
                    payload["error"] = "Tool ended before a terminal ACP update arrived"
                self.event_queue.put_nowait(
                    StreamEvent(
                        type="tool_completed" if completed else "tool_failed",
                        tool=payload,
                    )
                )
            self._active_tools.clear()
            self._completed_on_start.clear()
        self._resolved_permissions.clear()
        self._permission_option_modes.clear()
        # Unanswered client prompts must not outlive the turn.
        self.dismiss_pending_permissions()
        self.dismiss_pending_elicitations()
        self.event_queue.put_nowait(_SENTINEL)

    def dismiss_pending_permissions(self) -> None:
        # Agent still alive: "" resolves as a proper DeniedOutcome("cancelled") RPC response.
        for request_id, future in self._pending_permissions.items():
            if not future.done():
                future.set_result("")
                if not self.channel_member:
                    self.event_queue.put_nowait(
                        StreamEvent(type="permission_dismissed", request_id=request_id)
                    )
        self._pending_permissions.clear()

    def cancel_pending_permissions(self) -> None:
        # Teardown/dead process: no response can be delivered, just unblock the waiters.
        for future in self._pending_permissions.values():
            if not future.done():
                future.cancel()
        self._pending_permissions.clear()

    def dismiss_pending_elicitations(self) -> None:
        for request_id, future in self._pending_elicitations.items():
            if not future.done():
                future.set_result(("cancel", None))
                self._pending_elicitation_payloads.pop(request_id, None)
                self.event_queue.put_nowait(
                    StreamEvent(type="elicitation_dismissed", request_id=request_id)
                )
        self._pending_elicitations.clear()
        self._pending_elicitation_payloads.clear()

    def cancel_pending_elicitations(self) -> None:
        for future in self._pending_elicitations.values():
            if not future.done():
                future.cancel()
        self._pending_elicitations.clear()
        self._pending_elicitation_payloads.clear()

    @staticmethod
    def is_sentinel(obj: Any) -> bool:
        return obj is _SENTINEL

    async def session_update(
        self,
        session_id: str,
        update: Any,
        **kwargs: Any,
    ) -> None:
        # Applied in observe_stream; the SDK reports method-not-found without this.
        pass

    def apply_session_update(self, session_id: str, update: Any) -> None:
        if isinstance(update, CurrentModeUpdate):
            self.on_mode_update(update.current_mode_id)
            return
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
        # Emit permission_request and block until the user responds via SSE.
        request_id = tool_call.tool_call_id
        tool_name = self._extract_tool_name(tool_call)
        tool_input = self._extract_tool_input(tool_call)

        option_dicts = []
        for opt in options:
            option_id: str = getattr(opt, "option_id", getattr(opt, "optionId", ""))
            permission_mode: PermissionMode | None = (
                cast(PermissionMode, option_id)
                if option_id in VALID_PERMISSION_MODES
                else PERMISSION_MODE_BY_OPTION_ID.get(option_id)
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
        # Empty option_id means cancelled/dismissed.
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._pending_permissions[request_id] = future
        try:
            if self.channel_member:
                try:
                    return await asyncio.wait_for(
                        future, timeout=CHANNEL_PERMISSION_TIMEOUT_SECONDS
                    )
                except TimeoutError:
                    return ""
            return await future
        finally:
            self._pending_permissions.pop(request_id, None)
            self._permission_option_modes.pop(request_id, None)
            if self.channel_member:
                self.event_queue.put_nowait(
                    StreamEvent(type="permission_resolved", request_id=request_id)
                )

    def resolve_permission(
        self,
        request_id: str,
        *,
        option_id: str = "",
    ) -> bool:
        # Unblock _wait_for_user_choice; empty option_id = cancelled.
        future = self._pending_permissions.get(request_id)
        if future is None or future.done():
            return False

        if option_id:
            option_modes = self._permission_option_modes.pop(request_id, {})
            self._resolved_permissions[request_id] = option_modes.get(option_id)
        else:
            self._permission_option_modes.pop(request_id, None)

        future.set_result(option_id)
        if not self.channel_member:
            self.event_queue.put_nowait(
                StreamEvent(type="permission_dismissed", request_id=request_id)
            )
        return True

    async def create_elicitation(
        self,
        message: str,
        mode: ElicitationMode,
        **kwargs: Any,
    ) -> CreateElicitationResponse:
        if not isinstance(
            mode, (ElicitationFormSessionMode, ElicitationFormRequestMode)
        ):
            return CancelElicitationResponse(action="cancel")

        tool_call_id = getattr(mode, "tool_call_id", None)
        self._elicitation_counter += 1
        request_id = f"elicit-{self._elicitation_counter}"

        future: asyncio.Future[
            tuple[Literal["accept", "decline", "cancel"], dict[str, Any] | None]
        ] = asyncio.get_running_loop().create_future()
        self._pending_elicitations[request_id] = future
        requested_schema = mode.requested_schema.model_dump(
            mode="json", by_alias=True, exclude_none=True
        )
        payload = {
            "message": message,
            "tool_call_id": tool_call_id,
            "requested_schema": requested_schema,
        }
        self._pending_elicitation_payloads[request_id] = payload
        self.event_queue.put_nowait(
            StreamEvent(
                type="elicitation_request",
                request_id=request_id,
                data=payload,
            )
        )

        try:
            if self.channel_member:
                try:
                    action, content = await asyncio.wait_for(
                        future, timeout=CHANNEL_ELICITATION_TIMEOUT_SECONDS
                    )
                except TimeoutError:
                    action, content = "decline", None
            else:
                action, content = await future
        finally:
            self._pending_elicitations.pop(request_id, None)
            self._pending_elicitation_payloads.pop(request_id, None)
            if self.channel_member:
                self.event_queue.put_nowait(
                    StreamEvent(type="elicitation_resolved", request_id=request_id)
                )

        if action == "accept":
            return AcceptElicitationResponse(action="accept", content=content or {})
        if action == "decline":
            return DeclineElicitationResponse(action="decline")
        return CancelElicitationResponse(action="cancel")

    async def complete_elicitation(
        self,
        elicitation_id: str,
        **kwargs: Any,
    ) -> None:
        try:
            future = self._pending_elicitations.get(elicitation_id)
            if future is None or future.done():
                self._pending_elicitation_payloads.pop(elicitation_id, None)
                return
            future.set_result(("cancel", None))
            self._pending_elicitation_payloads.pop(elicitation_id, None)
            self.event_queue.put_nowait(
                StreamEvent(type="elicitation_dismissed", request_id=elicitation_id)
            )
        except Exception:
            logger.debug(
                "Failed to complete elicitation %s", elicitation_id, exc_info=True
            )

    def resolve_elicitation(
        self,
        request_id: str,
        *,
        action: Literal["accept", "decline", "cancel"],
        content: dict[str, Any] | None = None,
    ) -> bool:
        future = self._pending_elicitations.get(request_id)
        if future is None or future.done():
            self._pending_elicitation_payloads.pop(request_id, None)
            return False
        self._pending_elicitation_payloads.pop(request_id, None)
        future.set_result((action, content if action == "accept" else None))
        if not self.channel_member:
            self.event_queue.put_nowait(
                StreamEvent(type="elicitation_dismissed", request_id=request_id)
            )
        return True

    async def read_text_file(
        self,
        path: str,
        session_id: str,
        limit: int | None = None,
        line: int | None = None,
        **kwargs: Any,
    ) -> ReadTextFileResponse:
        # Agent owns file/terminal I/O; no-ops satisfy the ACP client interface.
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
        if method == self._adapter.ask_user_question_method:
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
                return self._adapter.question_response(None)
            answers[question_text] = selected
        return self._adapter.question_response(answers)

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
            parent_id=self._adapter.parent_tool_id(tc),
            input=self._extract_tool_input(tc),
        )
        if tc.locations:
            payload["path"] = tc.locations[0].path
        # Codex attaches edit diffs as content blocks on the initial tool_call
        # (and re-sent tool_call updates), while its terminal tool_call_update
        # carries only a status — capture the diffs here or they're lost.
        diffs = self._adapter.content_diffs(tc)
        if diffs:
            payload["result"] = {"diffs": diffs}
        self._active_tools[tc.tool_call_id] = payload
        if tc.status == "completed":
            self._completed_on_start.add(tc.tool_call_id)
        else:
            self._completed_on_start.discard(tc.tool_call_id)
        return StreamEvent(type="tool_started", tool=payload)

    def _map_tool_call_progress(self, tc: ToolCallProgress) -> StreamEvent | None:
        # Multiple progress events per tool possible; re-emit only when title/input changes.
        status = tc.status

        # Heartbeat ids never get a terminal update, so materializing one would
        # leave a card spinning until finish() sweeps it completed.
        if _HEARTBEAT_TOOL_ID_RE.search(tc.tool_call_id):
            return None

        existing = self._active_tools.get(tc.tool_call_id)
        if existing is None and status is None:
            return None

        materialized = existing is None
        if existing is None:
            # Update for a tool we never saw start. Use the real name from the
            # adapter's _meta when present; drop updates that carry no
            # renderable identity at all instead of minting "Unknown tool"
            # cards that finish() later stamps completed.
            meta_tool_name = self._adapter.meta_tool_name(
                tc
            ) or self._wire_tool_names.get(tc.tool_call_id)
            if (
                not tc.title
                and tc.raw_input is None
                and meta_tool_name is None
                and self._adapter.extract_tool_result(tc) is None
            ):
                logger.debug(
                    "Dropping update for untracked tool %s (status=%s)",
                    tc.tool_call_id,
                    status,
                )
                return None
            existing = ToolPayload(
                id=tc.tool_call_id,
                name=meta_tool_name or "unknown",
                title=meta_tool_name or "Unknown tool",
                status=ToolStatus.STARTED.value,
                parent_id=self._adapter.parent_tool_id(tc),
                input=None,
            )

        changed = False
        if tc.title and tc.title != existing.get("title"):
            existing["title"] = tc.title
            changed = True
        if tc.raw_input is not None:
            parsed_input = self._extract_tool_input(tc)
            if parsed_input != existing.get("input"):
                existing["input"] = parsed_input
                changed = True
        if tc.locations and tc.locations[0].path != existing.get("path"):
            existing["path"] = tc.locations[0].path
            changed = True

        if status in ("completed", "failed"):
            self._active_tools.pop(tc.tool_call_id, None)
            self._completed_on_start.discard(tc.tool_call_id)
            self._wire_tool_names.pop(tc.tool_call_id, None)
        if status == "completed":
            existing["status"] = ToolStatus.COMPLETED.value
            result = self._adapter.extract_tool_result(tc)
            # Codex edit diffs were captured from earlier tool_call events —
            # don't wipe them when the terminal update carries no result.
            if result is not None or "result" not in existing:
                existing["result"] = result
            if self._adapter.tool_images_in_content and (
                images := self._extract_content_images(tc)
            ):
                existing["images"] = images
            selected_mode = self._resolved_permissions.pop(tc.tool_call_id, None)
            if selected_mode is not None:
                existing["permission_mode"] = selected_mode
            return StreamEvent(type="tool_completed", tool=existing)
        if status == "failed":
            existing["status"] = ToolStatus.FAILED.value
            existing["error"] = self._adapter.extract_tool_error(tc)
            selected_mode = self._resolved_permissions.pop(tc.tool_call_id, None)
            if selected_mode is not None:
                existing["permission_mode"] = selected_mode
            return StreamEvent(type="tool_failed", tool=existing)

        self._active_tools[tc.tool_call_id] = existing
        # Emit tool_started for a newly materialized card (first appearance),
        # and re-emit when input arrives or the title changes so the frontend
        # can update the loading title.
        if materialized or changed:
            return StreamEvent(type="tool_started", tool=existing)
        return None

    def _map_usage_update(self, usage: UsageUpdate) -> StreamEvent | None:
        if usage.cost is not None:
            self.total_cost_usd = usage.cost.amount
        self.usage = {
            "input_tokens": usage.used,
            "context_window": usage.size,
        }
        event = StreamEvent(type="usage", data=self.usage)
        rate_limits = self._adapter.rate_limits(usage.field_meta)
        if rate_limits is not None:
            event["rate_limits"] = rate_limits
        return event

    def _map_session_info(self, info: SessionInfoUpdate) -> StreamEvent | None:
        # session_id comes from the outer SessionNotification and is injected
        # by apply_session_update(). Always emit so the caller can attach the session_id.
        return StreamEvent(type="system", data={})

    def _map_plan(self, plan: AgentPlanUpdate) -> StreamEvent | None:
        # Claude sends TodoWrite and Task* state only as plan updates.
        if not self._adapter.forwards_plan:
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

    def _extract_tool_name(self, tc: Any) -> str:
        # Codex/Copilot/Cursor use the top-level `kind` field; the adapter
        # hooks cover agents that name their tools elsewhere.
        if tool_name := self._adapter.meta_tool_name(tc):
            return tool_name
        if normalized := self._adapter.normalize_tool_call(tc):
            return normalized[0]
        if tool_name := self._wire_tool_names.get(tc.tool_call_id):
            return tool_name
        kind = getattr(tc, "kind", None)
        if kind:
            return str(kind)
        return str(getattr(tc, "title", None) or "unknown")

    def _extract_tool_input(self, tc: Any) -> dict[str, Any] | None:
        if normalized := self._adapter.normalize_tool_call(tc):
            return normalized[1]
        return self._adapter.parse_raw_input(getattr(tc, "raw_input", None))

    @staticmethod
    def _extract_content_images(tc: ToolCallProgress) -> list[ToolImage]:
        images: list[ToolImage] = []
        for block in tc.content or []:
            inner = getattr(block, "content", None)
            if not isinstance(inner, ImageContentBlock):
                continue
            try:
                data = base64.b64decode(inner.data, validate=True)
            except binascii.Error:
                continue
            if image := tool_image(data):
                images.append(image)
        return images
