import asyncio
import json
import logging
import re
import shlex
from asyncio import QueueEmpty, QueueFull
from dataclasses import dataclass, field
from functools import partial
from typing import Callable, TypeVar

from fastapi import WebSocket

from app.constants import PTY_INPUT_QUEUE_SIZE, PTY_OUTPUT_QUEUE_SIZE
from app.services.exceptions import SandboxException
from app.services.git import GitService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import SandboxProviderType
from app.services.sandbox_providers.base import SandboxProvider

logger = logging.getLogger(__name__)

TMUX_NAME_UNSAFE_RE = re.compile(r"[^A-Za-z0-9]")

_T = TypeVar("_T")


@dataclass
class TerminalSessionRecord:
    user_id: str
    sandbox_id: str
    terminal_id: str
    # Workspace-relative shell start dir; "" means the workspace root.
    cwd: str
    sandbox_service: SandboxService
    on_close: Callable[[], None]
    pty_id: str | None = None
    output_task: asyncio.Task[None] | None = None
    output_queue: asyncio.Queue[str] | None = None
    input_task: asyncio.Task[None] | None = None
    input_queue: asyncio.Queue[bytes] | None = None
    active_websocket: WebSocket | None = None
    tmux_session_name: str | None = None
    pty_exit_task: asyncio.Task[None] | None = None
    start_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def ensure_started(self, rows: int, cols: int) -> None:
        # Serialized: a page refresh can race two connections into the same
        # record; without the lock both see pty_id=None and spawn two PTYs.
        async with self.start_lock:
            if self.pty_id is None:
                tmux_session = self._get_tmux_session_name()
                self.output_queue = asyncio.Queue(maxsize=PTY_OUTPUT_QUEUE_SIZE)
                self.pty_id = await self.sandbox_service.create_pty_session(
                    self.sandbox_id,
                    rows,
                    cols,
                    tmux_session,
                    self.cwd,
                    on_data=self._enqueue_output,
                    on_exit=self._schedule_pty_exit,
                )
                self.input_queue = asyncio.Queue(maxsize=PTY_INPUT_QUEUE_SIZE)
                self.input_task = asyncio.create_task(self._input_worker(self.pty_id))
                self.input_task.add_done_callback(self._handle_input_task_done)
                return

            await self.resize(rows, cols)

    def enqueue_input(self, data: bytes) -> None:
        if not self.input_queue:
            return
        self._force_enqueue(self.input_queue, data)

    async def resize(self, rows: int, cols: int) -> None:
        if not self.pty_id:
            return
        await self.sandbox_service.resize_pty_session(
            self.sandbox_id,
            self.pty_id,
            rows,
            cols,
        )

    async def attach(self, websocket: WebSocket) -> None:
        if self.active_websocket and self.active_websocket is not websocket:
            try:
                await self.active_websocket.close()
            except (RuntimeError, OSError):
                pass

        self.active_websocket = websocket

        if not self.pty_id:
            return

        if self.output_task:
            self.output_task.cancel()

        self.output_task = asyncio.create_task(self._forward_output(websocket))

    async def detach(self) -> None:
        self.active_websocket = None
        if self.output_task:
            self.output_task.cancel()
            self.output_task = None

    async def close(self) -> None:
        self.active_websocket = None

        if self.output_task:
            self.output_task.cancel()
            self.output_task = None

        if self.input_task:
            self.input_task.cancel()
            try:
                await self.input_task
            except asyncio.CancelledError:
                pass
            self.input_task = None

        self.input_queue = None
        self.output_queue = None

        if self.pty_id:
            await self.sandbox_service.cleanup_pty_session(self.sandbox_id, self.pty_id)
            self.pty_id = None

        await self.sandbox_service.cleanup()

        self.on_close()

    async def terminate(self) -> None:
        await self.kill_tmux_session()
        await self.close()

    def _schedule_pty_exit(self) -> None:
        # Fired from inside the provider's reader task — hop to a fresh task
        # (kept on self so it isn't GC'd) so close()'s kill_pty can cancel and
        # await the reader without the reader awaiting itself.
        self.pty_exit_task = asyncio.create_task(self._handle_pty_exit())

    async def _handle_pty_exit(self) -> None:
        # The shell/tmux died on its own (exit, sandbox restart) — drop the
        # record so the next connect starts a fresh PTY instead of silently
        # reattaching to a dead one, and close the client so it can offer
        # a reconnect instead of freezing.
        websocket = self.active_websocket
        try:
            await self.close()
        except (OSError, RuntimeError, SandboxException) as exc:
            logger.error("Failed to clean up exited terminal session: %s", exc)
        if websocket:
            try:
                await websocket.close()
            except (RuntimeError, OSError):
                pass

    async def refresh_tmux_client(self) -> None:
        # Repaint the reattached terminal via tmux itself — Ctrl-L to the pane's
        # stdin only redraws shells; full-screen TUIs swallow it, leaving the
        # fresh xterm blank.
        if self.pty_id is None:
            return
        session_name = shlex.quote(self._get_tmux_session_name())
        command = (
            "for c in $(tmux list-clients -t "
            + session_name
            + " -F '#{client_name}'); "
            'do tmux refresh-client -t "$c"; done'
        )
        try:
            await self.sandbox_service.execute_command(self.sandbox_id, command)
        except (OSError, RuntimeError, SandboxException):
            pass

    async def kill_tmux_session(self) -> None:
        session_name = self._get_tmux_session_name()
        try:
            await self.sandbox_service.execute_command(
                self.sandbox_id, f"tmux kill-session -t {shlex.quote(session_name)}"
            )
        except (OSError, RuntimeError, SandboxException):
            pass

    def _get_tmux_session_name(self) -> str:
        if self.tmux_session_name is None:
            safe_terminal = self.terminal_id.replace("-", "_")
            safe_sandbox = self.sandbox_id.replace("-", "_")
            name = f"agentrove_{safe_sandbox}_{safe_terminal}"
            if self.cwd:
                # Worktree terminals need their own tmux session — reattaching
                # a root-cwd session would land the user outside the worktree.
                name += "_" + TMUX_NAME_UNSAFE_RE.sub("_", self.cwd)
            self.tmux_session_name = name
        return self.tmux_session_name

    async def _input_worker(self, session_id: str) -> None:
        if self.input_queue is None:
            return

        while True:
            buffer = await self._drain(self.input_queue)
            payload = b"".join(buffer)
            await self.sandbox_service.send_pty_input(
                self.sandbox_id, session_id, payload
            )

    async def _enqueue_output(self, data: bytes) -> None:
        if not self.output_queue:
            return
        self._force_enqueue(self.output_queue, data.decode("utf-8", errors="replace"))

    async def _forward_output(self, websocket: WebSocket) -> None:
        if not self.output_queue:
            return
        try:
            while True:
                buffer = await self._drain(self.output_queue)
                payload = json.dumps({"type": "stdout", "data": "".join(buffer)})
                await websocket.send_text(payload)
        except asyncio.CancelledError:
            raise
        except (OSError, RuntimeError) as e:
            logger.error(
                "Error forwarding PTY output for sandbox %s: %s",
                self.sandbox_id,
                e,
                exc_info=True,
            )

    @staticmethod
    def _force_enqueue(queue: "asyncio.Queue[_T]", item: "_T") -> bool:
        # Drop the oldest item if the queue is full so fast producers (PTY output,
        # user keystrokes) never block — losing a stale frame is better than backpressure.
        try:
            queue.put_nowait(item)
            return True
        except QueueFull:
            try:
                queue.get_nowait()
            except QueueEmpty:
                pass
            try:
                queue.put_nowait(item)
                return True
            except QueueFull:
                return False

    @staticmethod
    async def _drain(queue: "asyncio.Queue[_T]") -> "list[_T]":
        # Wait for at least one item, then grab everything else available without
        # blocking. This batches rapid bursts (e.g. fast terminal output) into a
        # single WebSocket frame or PTY write.
        first = await queue.get()
        buffer = [first]
        while True:
            try:
                buffer.append(queue.get_nowait())
            except QueueEmpty:
                break
        return buffer

    @staticmethod
    def _handle_input_task_done(task: asyncio.Task[None]) -> None:
        try:
            task.result()
        except asyncio.CancelledError:
            pass
        except (OSError, RuntimeError) as exc:
            logger.error("Error in input task: %s", exc)


class TerminalSessionRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, TerminalSessionRecord] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def build_session_key(
        user_id: str, sandbox_id: str, terminal_id: str, cwd: str
    ) -> str:
        # cwd is part of the identity — chats in the same workspace share
        # terminal ids, but a worktree chat must not reattach to a root-cwd
        # session (or vice versa).
        return f"{user_id}:{sandbox_id}:{terminal_id}:{cwd}"

    async def get_or_create(
        self,
        *,
        user_id: str,
        sandbox_id: str,
        terminal_id: str,
        cwd: str,
        provider_type: SandboxProviderType,
        workspace_path: str | None,
    ) -> TerminalSessionRecord:
        key = self.build_session_key(user_id, sandbox_id, terminal_id, cwd)
        async with self._lock:
            existing = self._sessions.get(key)
            if existing:
                return existing

            provider = SandboxProvider.create_provider(
                provider_type, workspace_path=workspace_path
            )
            service = SandboxService(provider)

            record = TerminalSessionRecord(
                user_id=user_id,
                sandbox_id=sandbox_id,
                terminal_id=terminal_id,
                cwd=cwd,
                sandbox_service=service,
                on_close=partial(self._remove, key),
            )
            self._sessions[key] = record
            return record

    def _remove(self, key: str) -> None:
        self._sessions.pop(key, None)

    async def terminate_for_sandbox(self, sandbox_id: str) -> None:
        # Workspace-deletion path: kill this sandbox's PTYs and tmux sessions
        # while the sandbox still exists, and drop the records so they don't
        # outlive the workspace.
        async with self._lock:
            sessions = [
                s for s in self._sessions.values() if s.sandbox_id == sandbox_id
            ]
        await self._terminate_sessions(sessions)

    async def terminate_all(self) -> None:
        async with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        await self._terminate_sessions(sessions)

    @staticmethod
    async def _terminate_sessions(sessions: list[TerminalSessionRecord]) -> None:
        results = await asyncio.gather(
            *[session.terminate() for session in sessions], return_exceptions=True
        )
        for result in results:
            if isinstance(result, Exception):
                logger.error("Failed to terminate terminal session: %s", result)


terminal_session_registry = TerminalSessionRegistry()


async def teardown_workspace_sandbox(
    sandbox_id: str,
    sandbox_service: SandboxService,
    worktree_cwds: list[str],
) -> None:
    # Every workspace-sandbox deletion funnels through here so the ordering
    # can't drift: terminals must die while the sandbox still exists (tmux
    # kill-session runs inside it), then chat worktrees are removed (host
    # sandboxes keep the repo files after deletion, so worktrees would leak),
    # then the sandbox itself is deleted.
    await terminal_session_registry.terminate_for_sandbox(sandbox_id)
    if worktree_cwds:
        git_service = GitService(sandbox_service)
        await asyncio.gather(
            *[git_service.remove_worktree(sandbox_id, cwd) for cwd in worktree_cwds],
            return_exceptions=True,
        )
    await sandbox_service.delete_sandbox(sandbox_id)
