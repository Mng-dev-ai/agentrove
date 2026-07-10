from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from acp.agent.connection import AgentSideConnection
from acp.schema import (
    AgentCapabilities,
    AgentMessageChunk,
    AgentPlanUpdate,
    AgentThoughtChunk,
    ContentToolCallContent,
    CreateTerminalResponse,
    CurrentModeUpdate,
    Cost,
    FileEditToolCallContent,
    ImageContentBlock,
    InitializeResponse,
    KillTerminalResponse,
    ListSessionsResponse,
    LoadSessionResponse,
    NewSessionResponse,
    PermissionOption,
    PlanEntry,
    PromptResponse,
    ReadTextFileResponse,
    ReleaseTerminalResponse,
    SessionInfoUpdate,
    SetSessionConfigOptionResponse,
    SetSessionModeResponse,
    SetSessionModelResponse,
    TerminalOutputResponse,
    TextContentBlock,
    ToolCallProgress,
    ToolCallStart,
    ToolCallUpdate,
    UsageUpdate,
    UserMessageChunk,
    WaitForTerminalExitResponse,
    WriteTextFileResponse,
)
from acp.stdio import stdio_streams

# Session-lifecycle behavior, selected once at process start (mirrors how a real
# agent binary would fail deterministically at handshake/session-setup time).
SCENARIO = os.environ.get("FAKE_ACP_SCENARIO", "normal")
LOG_PATH = os.environ.get("FAKE_ACP_LOG")
NEW_SESSION_ID = "fake-acp-session-1"

# Per-turn behavior is picked by looking for one of these markers inside the
# prompt text the real client sent — lets one fake binary cover every branch
# in client.py/session.py without spawning a different process per case.
MARKER_TOOL_DIFF = "MARKER_TOOL_DIFF"
MARKER_TOOL_TEXT_RESULT = "MARKER_TOOL_TEXT_RESULT"
MARKER_TOOL_CODEX_ERROR = "MARKER_TOOL_CODEX_ERROR"
MARKER_TOOL_STRING_ERROR = "MARKER_TOOL_STRING_ERROR"
MARKER_TOOL_TEXT_ERROR = "MARKER_TOOL_TEXT_ERROR"
MARKER_TOOL_PROGRESS_ORPHAN = "MARKER_TOOL_PROGRESS_ORPHAN"
MARKER_TOOL_PROGRESS_NEW = "MARKER_TOOL_PROGRESS_NEW"
MARKER_RAW_INPUT_STRING = "MARKER_RAW_INPUT_STRING"
MARKER_RAW_INPUT_INVALID = "MARKER_RAW_INPUT_INVALID"
MARKER_PERMISSION = "MARKER_PERMISSION"
MARKER_CANCEL = "MARKER_CANCEL"
MARKER_CRASH_MID_PROMPT = "MARKER_CRASH_MID_PROMPT"
MARKER_TOOL_LEFT_OPEN = "MARKER_TOOL_LEFT_OPEN"
MARKER_FS_TERMINAL_STUBS = "MARKER_FS_TERMINAL_STUBS"
MARKER_IMAGE_CONTENT = "MARKER_IMAGE_CONTENT"
MARKER_TOOL_EMPTY_RESULT = "MARKER_TOOL_EMPTY_RESULT"
MARKER_TOOL_UNKNOWN_DICT_ERROR = "MARKER_TOOL_UNKNOWN_DICT_ERROR"
MARKER_ENTER_PLAN_MODE = "MARKER_ENTER_PLAN_MODE"
# 1x1 transparent PNG, reused wherever the protocol needs inline image bytes.
TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def log_event(record: dict[str, Any]) -> None:
    # Best-effort JSONL audit trail so tests can assert on exactly what the
    # real client sent (mcp servers, session ids, model ids, ...).
    if not LOG_PATH:
        return
    with open(LOG_PATH, "a") as handle:
        handle.write(json.dumps(record, default=str) + "\n")


def text_block(text: str) -> TextContentBlock:
    return TextContentBlock(type="text", text=text)


class FakeAgent:
    def __init__(self) -> None:
        self._client: AgentSideConnection | None = None
        self._cancel_events: dict[str, asyncio.Event] = {}

    def on_connect(self, conn: AgentSideConnection) -> None:
        self._client = conn

    async def initialize(
        self,
        protocol_version: int,
        client_capabilities: Any = None,
        client_info: Any = None,
        **kwargs: Any,
    ) -> InitializeResponse:
        if SCENARIO == "crash_initialize":
            raise RuntimeError("simulated initialize failure")
        return InitializeResponse(
            protocol_version=protocol_version,
            agent_capabilities=AgentCapabilities(load_session=True),
        )

    async def new_session(
        self,
        cwd: str,
        mcp_servers: list[Any] | None = None,
        **kwargs: Any,
    ) -> NewSessionResponse:
        log_event(
            {
                "event": "new_session",
                "cwd": cwd,
                "mcp_servers": [
                    server.model_dump(mode="json", by_alias=True)
                    for server in (mcp_servers or [])
                ],
            }
        )
        if SCENARIO == "crash_new_session":
            raise RuntimeError("simulated new_session failure")
        return NewSessionResponse(session_id=NEW_SESSION_ID)

    async def load_session(
        self,
        cwd: str,
        session_id: str,
        mcp_servers: list[Any] | None = None,
        **kwargs: Any,
    ) -> LoadSessionResponse:
        log_event({"event": "load_session", "cwd": cwd, "session_id": session_id})
        if SCENARIO == "crash_load_session":
            raise RuntimeError("simulated load_session failure")
        if SCENARIO == "load_session_replay" and self._client is not None:
            # Simulates an agent that replays prior history on resume — the
            # real client must mute these via handler.muted during load_session.
            await self._client.session_update(
                session_id=session_id,
                update=AgentMessageChunk(
                    session_update="agent_message_chunk",
                    content=text_block("REPLAYED_HISTORY_SHOULD_BE_MUTED"),
                ),
            )
        return LoadSessionResponse()

    async def list_sessions(
        self, cursor: str | None = None, cwd: str | None = None, **kwargs: Any
    ) -> ListSessionsResponse:
        return ListSessionsResponse(sessions=[])

    async def set_session_mode(
        self, mode_id: str, session_id: str, **kwargs: Any
    ) -> SetSessionModeResponse:
        log_event({"event": "set_session_mode", "mode_id": mode_id})
        if SCENARIO == "config_error":
            raise RuntimeError("simulated set_session_mode failure")
        return SetSessionModeResponse()

    async def set_session_model(
        self, model_id: str, session_id: str, **kwargs: Any
    ) -> SetSessionModelResponse:
        log_event({"event": "set_session_model", "model_id": model_id})
        if SCENARIO == "config_error":
            raise RuntimeError("simulated set_session_model failure")
        return SetSessionModelResponse()

    async def set_config_option(
        self, config_id: str, session_id: str, value: str | bool, **kwargs: Any
    ) -> SetSessionConfigOptionResponse:
        log_event(
            {"event": "set_config_option", "config_id": config_id, "value": value}
        )
        if SCENARIO == "config_error":
            raise RuntimeError("simulated set_config_option failure")
        return SetSessionConfigOptionResponse(config_options=[])

    async def authenticate(self, method_id: str, **kwargs: Any) -> None:
        return None

    async def fork_session(
        self,
        cwd: str,
        session_id: str,
        mcp_servers: list[Any] | None = None,
        **kwargs: Any,
    ) -> None:
        raise NotImplementedError

    async def resume_session(
        self,
        cwd: str,
        session_id: str,
        mcp_servers: list[Any] | None = None,
        **kwargs: Any,
    ) -> None:
        raise NotImplementedError

    async def close_session(self, session_id: str, **kwargs: Any) -> None:
        return None

    async def cancel(self, session_id: str, **kwargs: Any) -> None:
        # session/cancel is a notification — the pending prompt() request below
        # is what actually unblocks the client's send_prompt() call.
        self._cancel_events.setdefault(session_id, asyncio.Event()).set()

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        return {}

    async def ext_notification(self, method: str, params: dict[str, Any]) -> None:
        return None

    async def prompt(
        self,
        prompt: list[Any],
        session_id: str,
        message_id: str | None = None,
        **kwargs: Any,
    ) -> PromptResponse:
        assert self._client is not None
        text = "".join(
            block.text for block in prompt if getattr(block, "type", None) == "text"
        )
        block_types = [getattr(block, "type", None) for block in prompt]
        log_event(
            {
                "event": "prompt",
                "session_id": session_id,
                "text": text,
                "block_types": block_types,
            }
        )

        if MARKER_CRASH_MID_PROMPT in text:
            # A hard os._exit() here would leave the client's pending prompt()
            # request unresolved forever (the ACP SDK's receive loop doesn't
            # reject in-flight requests on a clean EOF) — a real agent crash
            # would wedge the turn. Erroring the request instead exercises the
            # same finish(prompt_completed=False) path deterministically.
            await self._emit_tool_started(session_id, "tool-crash", "Doing risky work")
            raise RuntimeError("simulated mid-prompt agent failure")
        if MARKER_CANCEL in text:
            return await self._run_cancel_turn(session_id)
        if MARKER_PERMISSION in text:
            return await self._run_permission_turn(session_id)
        if MARKER_FS_TERMINAL_STUBS in text:
            await self._call_fs_terminal_stubs(session_id)
        if MARKER_ENTER_PLAN_MODE in text:
            return await self._run_enter_plan_mode_turn(session_id)

        return await self._run_default_turn(session_id, text)

    async def _call_fs_terminal_stubs(self, session_id: str) -> None:
        # Exercises every ACP client-side stub in client.py — real agents call
        # these for file/terminal access; ours never needs to, so drive them
        # directly to prove the no-op implementations satisfy the protocol.
        assert self._client is not None
        client = self._client
        try:
            read: ReadTextFileResponse = await client.read_text_file(
                path="app.py", session_id=session_id
            )
            log_event({"event": "debug", "step": "read_text_file", "ok": True})
        except Exception as exc:
            log_event({"event": "debug", "step": "read_text_file", "error": repr(exc)})
            raise
        assert read.content == ""
        try:
            write: WriteTextFileResponse | None = await client.write_text_file(
                content="x", path="app.py", session_id=session_id
            )
            log_event({"event": "debug", "step": "write_text_file", "ok": True})
        except Exception as exc:
            log_event({"event": "debug", "step": "write_text_file", "error": repr(exc)})
            raise
        assert write is not None
        try:
            terminal: CreateTerminalResponse = await client.create_terminal(
                command="echo hi", session_id=session_id
            )
            log_event({"event": "debug", "step": "create_terminal", "ok": True})
        except Exception as exc:
            log_event({"event": "debug", "step": "create_terminal", "error": repr(exc)})
            raise
        try:
            output: TerminalOutputResponse = await client.terminal_output(
                session_id=session_id, terminal_id=terminal.terminal_id
            )
            log_event({"event": "debug", "step": "terminal_output", "ok": True})
        except Exception as exc:
            log_event({"event": "debug", "step": "terminal_output", "error": repr(exc)})
            raise
        assert output.output == ""
        try:
            release: ReleaseTerminalResponse | None = await client.release_terminal(
                session_id=session_id, terminal_id=terminal.terminal_id
            )
            log_event({"event": "debug", "step": "release_terminal", "ok": True})
        except Exception as exc:
            log_event(
                {"event": "debug", "step": "release_terminal", "error": repr(exc)}
            )
            raise
        assert release is not None
        try:
            wait_result: WaitForTerminalExitResponse = (
                await client.wait_for_terminal_exit(
                    session_id=session_id, terminal_id=terminal.terminal_id
                )
            )
            log_event({"event": "debug", "step": "wait_for_terminal_exit", "ok": True})
        except Exception as exc:
            log_event(
                {"event": "debug", "step": "wait_for_terminal_exit", "error": repr(exc)}
            )
            raise
        assert wait_result.exit_code == 0
        try:
            kill: KillTerminalResponse | None = await client.kill_terminal(
                session_id=session_id, terminal_id=terminal.terminal_id
            )
            log_event({"event": "debug", "step": "kill_terminal", "ok": True})
        except Exception as exc:
            log_event({"event": "debug", "step": "kill_terminal", "error": repr(exc)})
            raise
        assert kill is not None
        try:
            ext_result = await client.ext_method("agentrove.debug", {"probe": True})
            log_event({"event": "debug", "step": "ext_method", "ok": True})
        except Exception as exc:
            log_event({"event": "debug", "step": "ext_method", "error": repr(exc)})
            raise
        assert ext_result == {}
        await client.ext_notification("agentrove.debug_note", {"probe": True})

    async def _run_enter_plan_mode_turn(self, session_id: str) -> PromptResponse:
        # AgentService._get_plan_mode_transition() only fires on a completed
        # tool literally named EnterPlanMode — reachable only through the
        # adapter's map_session_mode(), which Claude's build_session_config()
        # never calls directly (it passes permission_mode straight through).
        assert self._client is not None
        await self._client.session_update(
            session_id=session_id,
            update=ToolCallStart(
                session_update="tool_call",
                tool_call_id="tool-enter-plan",
                title="Entering plan mode",
                field_meta={"claudeCode": {"toolName": "EnterPlanMode"}},
            ),
        )
        await self._client.session_update(
            session_id=session_id,
            update=ToolCallProgress(
                session_update="tool_call_update",
                tool_call_id="tool-enter-plan",
                status="completed",
                field_meta={"claudeCode": {"toolName": "EnterPlanMode"}},
            ),
        )
        await asyncio.sleep(0.05)
        return PromptResponse(stop_reason="end_turn")

    async def _emit_tool_started(
        self,
        session_id: str,
        tool_call_id: str,
        title: str,
        *,
        field_meta: dict[str, Any] | None = None,
        raw_input: Any = None,
        kind: str = "execute",
    ) -> None:
        assert self._client is not None
        await self._client.session_update(
            session_id=session_id,
            update=ToolCallStart(
                session_update="tool_call",
                tool_call_id=tool_call_id,
                title=title,
                kind=kind,
                raw_input=raw_input,
                field_meta=field_meta,
            ),
        )

    async def _run_cancel_turn(self, session_id: str) -> PromptResponse:
        await self._emit_tool_started(
            session_id, "tool-cancel", "Working before cancel"
        )
        event = self._cancel_events.setdefault(session_id, asyncio.Event())
        try:
            await asyncio.wait_for(event.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            pass
        finally:
            self._cancel_events.pop(session_id, None)
        # Let already-scheduled notification-processing tasks land before
        # the response resolves the client's pending prompt() future — the
        # ACP SDK dispatches notifications as fire-and-forget tasks, so a
        # response arriving right behind them can race ahead undelivered.
        await asyncio.sleep(0.05)
        return PromptResponse(stop_reason="cancelled")

    async def _run_permission_turn(self, session_id: str) -> PromptResponse:
        assert self._client is not None
        tool_call_id = "tool-permission"
        await self._emit_tool_started(session_id, tool_call_id, "Editing a file")

        options = [
            PermissionOption(
                kind="allow_once", name="Accept Edits", option_id="acceptEdits"
            ),
            PermissionOption(
                kind="reject_once", name="Reject", option_id="reject-once"
            ),
            # A resolvable mode (unlike reject-once) that the "user" can still
            # pick and have the underlying command go on to fail — covers
            # tool_failed with a *resolved* permission_mode in client.py.
            PermissionOption(kind="allow_always", name="Plan", option_id="plan"),
        ]
        response = await self._client.request_permission(
            options=options,
            session_id=session_id,
            tool_call=ToolCallUpdate(tool_call_id=tool_call_id, status="pending"),
        )
        outcome = response.outcome
        selected_option_id = getattr(outcome, "option_id", None)

        if selected_option_id == "plan":
            await self._client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id=tool_call_id,
                    status="failed",
                    raw_output="Command failed even though a mode was approved",
                ),
            )
        elif selected_option_id:
            await self._client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id=tool_call_id,
                    status="completed",
                    raw_output={"decision": selected_option_id},
                ),
            )
        else:
            await self._client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id=tool_call_id,
                    status="failed",
                    raw_output="Permission denied by user",
                ),
            )
        await asyncio.sleep(0.05)
        return PromptResponse(stop_reason="end_turn")

    async def _run_default_turn(self, session_id: str, text: str) -> PromptResponse:
        assert self._client is not None
        client = self._client

        await client.session_update(
            session_id=session_id,
            update=AgentThoughtChunk(
                session_update="agent_thought_chunk",
                content=text_block("Thinking it over..."),
            ),
        )
        await client.session_update(
            session_id=session_id,
            update=AgentMessageChunk(
                session_update="agent_message_chunk", content=text_block("Hello from ")
            ),
        )
        await client.session_update(
            session_id=session_id,
            update=AgentMessageChunk(
                session_update="agent_message_chunk",
                content=text_block("the fake agent."),
            ),
        )
        await client.session_update(
            session_id=session_id,
            update=UserMessageChunk(
                session_update="user_message_chunk",
                content=text_block("(echoed user note)"),
            ),
        )
        if MARKER_IMAGE_CONTENT in text:
            # Non-text content on these three chunk kinds maps to None in
            # client.py (_map_agent_message/_map_agent_thought/_map_user_message)
            # — no event should reach the frontend for any of them.
            image_block = ImageContentBlock(
                type="image", data=TINY_PNG_BASE64, mimeType="image/png"
            )
            await client.session_update(
                session_id=session_id,
                update=AgentMessageChunk(
                    session_update="agent_message_chunk", content=image_block
                ),
            )
            await client.session_update(
                session_id=session_id,
                update=AgentThoughtChunk(
                    session_update="agent_thought_chunk", content=image_block
                ),
            )
            await client.session_update(
                session_id=session_id,
                update=UserMessageChunk(
                    session_update="user_message_chunk", content=image_block
                ),
            )
        # Not part of the client's mapped update union — exercises the
        # "Unhandled ACP update type" fallthrough in client.py.
        await client.session_update(
            session_id=session_id,
            update=CurrentModeUpdate(
                session_update="current_mode_update", current_mode_id="agent"
            ),
        )
        await client.session_update(
            session_id=session_id,
            update=SessionInfoUpdate(
                session_update="session_info_update", title="Fake session title"
            ),
        )

        raw_input: Any = {"path": "app.py"}
        if MARKER_RAW_INPUT_STRING in text:
            raw_input = json.dumps({"path": "encoded.py"})
        elif MARKER_RAW_INPUT_INVALID in text:
            raw_input = "not-json{{"

        await self._emit_tool_started(
            session_id,
            "tool-primary",
            "Reading a file",
            field_meta={
                "claudeCode": {"toolName": "Read", "parentToolUseId": "parent-1"}
            },
            raw_input=raw_input,
        )
        # Title-only update with no status — re-emitted as tool_started so the
        # UI can refresh the loading title before the tool finishes.
        await client.session_update(
            session_id=session_id,
            update=ToolCallProgress(
                session_update="tool_call_update",
                tool_call_id="tool-primary",
                title="Reading app.py",
            ),
        )
        if MARKER_RAW_INPUT_STRING not in text and MARKER_RAW_INPUT_INVALID not in text:
            # A later raw_input change (as opposed to the one on the initial
            # ToolCallStart) is a distinct client.py code path in
            # _map_tool_call_progress — cover it whenever the raw-input-on-start
            # variants above aren't the thing being asserted on.
            await client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id="tool-primary",
                    raw_input={"path": "app.py", "revised": True},
                ),
            )
        await self._complete_primary_tool(session_id, text)

        if MARKER_TOOL_PROGRESS_ORPHAN in text:
            # No matching active tool and no status — must be a silent no-op.
            await client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update", tool_call_id="tool-orphan"
                ),
            )
        if MARKER_TOOL_PROGRESS_NEW in text:
            # Never preceded by a ToolCallStart — client must synthesize one.
            await client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id="tool-new",
                    status="completed",
                    raw_output="synthesized result",
                ),
            )

        await self._emit_tool_started(session_id, "tool-secondary", "Running a command")
        if MARKER_TOOL_LEFT_OPEN in text:
            # Never sent a terminal update for tool-secondary — it's still
            # "active" when finish(prompt_completed=True) runs below, exercising
            # the leftover-tool auto-complete branch in client.py.
            pass
        elif MARKER_TOOL_TEXT_ERROR in text:
            await client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id="tool-secondary",
                    status="failed",
                    content=[
                        ContentToolCallContent(
                            type="content",
                            content=text_block("command failed: no output"),
                        )
                    ],
                ),
            )
        else:
            secondary_output: Any = {"error": "boom opencode"}
            if MARKER_TOOL_CODEX_ERROR in text:
                secondary_output = {"formatted_output": "boom codex"}
            elif MARKER_TOOL_STRING_ERROR in text:
                secondary_output = "boom plain string"
            elif MARKER_TOOL_UNKNOWN_DICT_ERROR in text:
                secondary_output = {"unexpected_key": "value"}
            await client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id="tool-secondary",
                    status="failed",
                    raw_output=secondary_output,
                ),
            )

        await client.session_update(
            session_id=session_id,
            update=UsageUpdate(
                session_update="usage_update",
                used=1234,
                size=100000,
                cost=Cost(amount=0.05, currency="USD"),
            ),
        )
        await client.session_update(
            session_id=session_id,
            update=AgentPlanUpdate(
                session_update="plan",
                entries=[
                    PlanEntry(
                        content="Investigate", status="completed", priority="high"
                    ),
                    PlanEntry(
                        content="Fix it", status="in_progress", priority="medium"
                    ),
                ],
            ),
        )

        await asyncio.sleep(0.05)
        return PromptResponse(stop_reason="end_turn")

    async def _complete_primary_tool(self, session_id: str, text: str) -> None:
        assert self._client is not None
        if MARKER_TOOL_DIFF in text:
            await self._client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id="tool-primary",
                    status="completed",
                    content=[
                        FileEditToolCallContent(
                            type="diff",
                            path="app.py",
                            old_text="old",
                            new_text="new",
                        )
                    ],
                ),
            )
            return
        if MARKER_TOOL_TEXT_RESULT in text:
            await self._client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id="tool-primary",
                    status="completed",
                    content=[
                        ContentToolCallContent(
                            type="content", content=text_block("plain text result")
                        )
                    ],
                ),
            )
            return
        if MARKER_TOOL_EMPTY_RESULT in text:
            # No raw_output, no diff/text content — _extract_tool_result falls
            # all the way through to its empty-content "return None" fallback.
            await self._client.session_update(
                session_id=session_id,
                update=ToolCallProgress(
                    session_update="tool_call_update",
                    tool_call_id="tool-primary",
                    status="completed",
                ),
            )
            return
        await self._client.session_update(
            session_id=session_id,
            update=ToolCallProgress(
                session_update="tool_call_update",
                tool_call_id="tool-primary",
                status="completed",
                field_meta={"claudeCode": {"toolResponse": {"lines": 42}}},
            ),
        )


async def main() -> None:
    reader, writer = await stdio_streams()
    agent = FakeAgent()
    # listening=False + explicit listen() below — the constructor's default
    # (listening=True) would start its own receive-loop task, racing this one
    # for the same stdin reader ("readuntil() called while another coroutine
    # is already waiting for incoming data").
    conn = AgentSideConnection(
        agent, writer, reader, listening=False, use_unstable_protocol=True
    )
    await conn.listen()


if __name__ == "__main__":
    asyncio.run(main())
