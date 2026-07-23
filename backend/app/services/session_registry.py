from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from app.services.acp.adapters import AgentKind
from app.services.acp.session import AcpSession, AcpSessionConfig

logger = logging.getLogger(__name__)

TASK_CANCEL_TIMEOUT_SECONDS = 5.0

IDLE_CHECK_INTERVAL_SECONDS = 60.0

PENDING_CANCEL_TTL_SECONDS = 30.0


@dataclass
class ChatSession:
    chat_id: str
    acp_session: AcpSession
    fingerprint: str
    current_model: str = ""
    current_mode: str = ""
    current_fast_mode: bool = False
    active_generation_task: asyncio.Task[Any] | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    last_used_at: float = field(default_factory=time.monotonic)


# In-process ACP sessions by chat_id. Fingerprint changes (model/env/MCP/etc.) tear down and recreate.
class SessionRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, ChatSession] = {}
        # Pending cancels are tracked separately so a cancel request that
        # arrives between generations (no active task to cancel) is still
        # honoured when the next generation starts.
        self._pending_cancels: dict[str, float] = {}

    async def get_or_create(
        self,
        *,
        chat_id: str,
        config: AcpSessionConfig,
    ) -> tuple[ChatSession, bool]:
        session = self._sessions.get(chat_id)
        fingerprint = self.compute_fingerprint(config)

        if session is not None and not session.acp_session.is_alive():
            await self._close_session(session)
            session = None

        if session is not None and session.fingerprint != fingerprint:
            # Keep config.resume_session_id: agent kind can't change mid-chat
            # (blocked upstream), so the respawned process can load_session the
            # old id and preserve context across model/effort changes.
            await self._close_session(session)
            session = None

        created = session is None
        if created:
            acp_session = await AcpSession.create(config)
            session = ChatSession(
                chat_id=chat_id,
                acp_session=acp_session,
                fingerprint=fingerprint,
                current_model=config.model,
                # create() already applied fast_mode when True; keep in sync so
                # the next turn doesn't re-send the same config option.
                current_fast_mode=config.fast_mode,
            )
            self._sessions[chat_id] = session

        assert session is not None
        session.last_used_at = time.monotonic()
        return session, created

    async def cancel_generation(self, chat_id: str) -> None:
        self._pending_cancels[chat_id] = time.monotonic()
        session = self._sessions.get(chat_id)
        if session is None:
            return
        session.cancel_event.set()
        await session.acp_session.cancel()

    def resolve_permission(
        self,
        chat_id: str,
        request_id: str,
        *,
        option_id: str = "",
    ) -> bool:
        session = self._sessions.get(chat_id)
        if session is None:
            return False
        return session.acp_session.handler.resolve_permission(
            request_id,
            option_id=option_id,
        )

    def consume_pending_cancel(self, chat_id: str) -> bool:
        created_at = self._pending_cancels.pop(chat_id, None)
        if created_at is None:
            return False
        if (time.monotonic() - created_at) <= PENDING_CANCEL_TTL_SECONDS:
            return True
        return False

    async def terminate(self, chat_id: str) -> None:
        session = self._sessions.pop(chat_id, None)
        if session is not None:
            await self._close_session(session)

    async def terminate_all(self) -> None:
        sessions = list(self._sessions.values())
        self._sessions.clear()
        await asyncio.gather(
            *[self._close_session(s) for s in sessions],
            return_exceptions=True,
        )

    def get(self, chat_id: str) -> ChatSession | None:
        return self._sessions.get(chat_id)

    async def close_idle_sessions(self, ttl_seconds: float) -> None:
        now = time.monotonic()
        expired: list[str] = []

        for chat_id, session in self._sessions.items():
            task = session.active_generation_task
            if task is not None and not task.done():
                continue
            if (now - session.last_used_at) >= ttl_seconds:
                expired.append(chat_id)

        await asyncio.gather(
            *[self._close_session(self._sessions.pop(cid)) for cid in expired],
            return_exceptions=True,
        )

        if expired:
            logger.info("Closed %d idle chat session(s)", len(expired))

    @staticmethod
    def compute_fingerprint(config: AcpSessionConfig) -> str:
        # cwd is stable per chat (workspace root or the chat's worktree, never
        # agent-reported paths), so including it respawns the agent process in
        # the worktree when worktree mode is enabled mid-chat — otherwise the
        # reused session keeps editing the workspace root while the UI targets
        # the worktree. resume_session_id carries context across the respawn.
        fingerprint_dict: dict[str, Any] = {
            "agent_kind": config.agent_kind.value,
            "cwd": config.cwd,
            "env": config.env,
            "mcp_servers": config.mcp_servers,
            "system_prompt": config.system_prompt,
            "reasoning_effort": config.reasoning_effort,
            # Grok bakes approval into launch, so mode changes must respawn;
            # resume_session_id preserves context. Other agents switch live,
            # so fingerprinting their mode would respawn needlessly.
            "permission_mode": (
                config.permission_mode if config.agent_kind is AgentKind.GROK else None
            ),
        }
        data = json.dumps(fingerprint_dict, sort_keys=True, default=str)
        return hashlib.sha256(data.encode()).hexdigest()

    @staticmethod
    async def _close_session(session: ChatSession) -> None:
        task = session.active_generation_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=TASK_CANCEL_TIMEOUT_SECONDS)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

        try:
            await session.acp_session.close()
        except (OSError, ConnectionError) as exc:
            logger.debug(
                "Error closing ACP session for chat %s: %s", session.chat_id, exc
            )


session_registry = SessionRegistry()
