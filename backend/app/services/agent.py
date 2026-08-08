import asyncio
import logging
import os
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlparse
from typing import Any, cast
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings
from app.core.security import create_mcp_access_token
from app.db.session import SessionLocal
from app.models.db_models.chat import Chat
from app.models.db_models.user import User, UserSettings
from app.models.types import PermissionMode
from app.prompts.enhance_prompt import ENHANCE_PROMPT
from app.prompts.generate_commit_message import (
    GENERATE_COMMIT_MESSAGE_SYSTEM_PROMPT,
)
from app.prompts.generate_pr_description import (
    GENERATE_PR_DESCRIPTION_SYSTEM_PROMPT,
    GENERATE_PR_DESCRIPTION_TITLE_PREFIX,
)
from app.prompts.inline_chat import INLINE_CHAT_SYSTEM_PROMPT
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.prompts.generate_title import GENERATE_TITLE_SYSTEM_PROMPT
from app.services.acp.adapters import AGENT_ADAPTERS, NORMAL_SESSION_MODE, AgentKind
from app.services.acp.client import AcpClientHandler
from app.services.acp.session import AcpSession, AcpSessionConfig
from app.services.exceptions import AgentException, ChatException, ErrorCode
from app.constants import MODELS
from app.services.git import GitService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import SandboxProviderType
from app.services.sandbox_providers.base import SandboxProvider
from app.services.streaming.types import StreamEvent
from app.services.user import UserService

settings = get_settings()
logger = logging.getLogger(__name__)

# MCP server ships next to the backend (bundled into the sidecar by run_build.mjs),
# so its path derives from this file: app/services/agent.py -> ../../mcp-server/server.py
MCP_SERVER_PATH = Path(__file__).resolve().parents[2] / "mcp-server" / "server.py"


class StreamResult:
    __slots__ = ("total_cost_usd", "usage")

    def __init__(self) -> None:
        self.total_cost_usd: float = 0.0
        self.usage: dict[str, Any] | None = None


class AgentService:
    def __init__(self, session_factory: Any | None = None) -> None:
        self.session_factory = session_factory or SessionLocal

    async def _get_user_settings(self, user_id: UUID) -> UserSettings:
        return await UserService(
            session_factory=self.session_factory
        ).get_user_settings(user_id)

    async def _save_worktree_cwd(self, chat_id: UUID, worktree_cwd: str) -> None:
        # Best-effort persistence — if it fails the worktree still exists on
        # disk but won't be reused on session resume (a new one will be created).
        try:
            async with self.session_factory() as db:
                await db.execute(
                    update(Chat)
                    .where(Chat.id == chat_id)
                    .values(worktree_cwd=worktree_cwd)
                )
                await db.commit()
        except (SQLAlchemyError, ValueError) as exc:
            logger.error("Failed to persist worktree_cwd for chat %s: %s", chat_id, exc)

    async def ensure_worktree_cwd(
        self, chat: Chat, base_branch: str | None = None
    ) -> str:
        if chat.worktree_cwd:
            return cast(str, chat.worktree_cwd)

        sandbox_id = chat.sandbox_id
        if not sandbox_id:
            return ""

        provider = SandboxProvider.create_provider(
            SandboxProviderType(chat.sandbox_provider),
            workspace_path=chat.workspace_path,
        )
        git_service = GitService(SandboxService(provider))
        worktree_cwd = await git_service.create_worktree(
            sandbox_id,
            "",
            str(chat.id),
            base_ref=base_branch,
        )
        chat.worktree_cwd = worktree_cwd
        await self._save_worktree_cwd(chat.id, worktree_cwd)
        return worktree_cwd

    async def resolve_cwd(
        self, chat: Chat, worktree: bool, base_branch: str | None = None
    ) -> str:
        # A chat already bound to a worktree (e.g. a sub-thread inheriting the
        # parent's) always runs in it, even when this turn didn't request one;
        # otherwise only materialize one when the turn asks and a sandbox exists.
        # "" is the canonical workspace root, resolved to an absolute cwd at the edge.
        if chat.worktree_cwd or (worktree and chat.sandbox_id):
            return await self.ensure_worktree_cwd(chat, base_branch)
        return ""

    async def build_session_config(
        self,
        *,
        user: User,
        chat: Chat,
        model_id: str,
        permission_mode: PermissionMode,
        session_id: str | None,
        thinking_mode: str | None = None,
        system_prompt: str | None = None,
        worktree: bool = False,
        base_branch: str | None = None,
        selected_persona_name: str = DEFAULT_PERSONA_NAME,
        fast_mode: bool = False,
    ) -> AcpSessionConfig:
        user_settings = await self._get_user_settings(user.id)

        sandbox_provider = SandboxProviderType(chat.sandbox_provider)
        sandbox_id: str = chat.sandbox_id or ""
        workspace_path = chat.workspace_path

        agent_kind = MODELS[model_id].agent_kind
        stored_agent_kind = getattr(chat, "session_agent_kind", None)
        if stored_agent_kind and stored_agent_kind != agent_kind.value:
            raise ChatException(
                f"Cannot switch from {stored_agent_kind} to {agent_kind.value} in the same chat",
                error_code=ErrorCode.VALIDATION_ERROR,
            )

        cwd = await self.resolve_cwd(chat, worktree, base_branch)

        is_custom_persona = selected_persona_name != DEFAULT_PERSONA_NAME

        return await self._build_acp_config(
            user_settings=user_settings,
            user_id=str(user.id),
            agent_kind=agent_kind,
            permission_mode=permission_mode,
            model_id=model_id,
            session_id=session_id,
            chat_id=str(chat.id),
            thinking_mode=thinking_mode,
            cwd=cwd,
            sandbox_provider=sandbox_provider,
            sandbox_id=sandbox_id,
            workspace_path=workspace_path,
            system_prompt=system_prompt,
            system_prompt_is_full_replace=is_custom_persona,
            # AcpSession is the codex boundary (create/set_fast_mode no-op elsewhere).
            fast_mode=fast_mode,
        )

    async def stream_response(
        self,
        session: AcpSession,
        prompt: str,
        custom_instructions: str | None,
        result: StreamResult,
        agent_kind: AgentKind = AgentKind.CLAUDE,
        attachments: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        user_content = self.prepare_user_prompt(prompt, custom_instructions)
        adapter = AGENT_ADAPTERS[agent_kind]

        handler = session.handler
        prompt_task = asyncio.create_task(
            session.send_prompt(
                user_content, attachments=attachments, agent_kind=agent_kind
            )
        )

        try:
            async for event in self._consume_events(handler.event_queue, prompt_task):
                yield event

                ui_mode = self._get_plan_mode_transition(event)
                if ui_mode:
                    session_mode = adapter.map_session_mode(ui_mode)
                    await session.set_mode(session_mode)

            result.total_cost_usd = handler.total_cost_usd
            result.usage = handler.usage

        except BaseException:
            await self._cancel_prompt_task(prompt_task)
            raise

    @staticmethod
    async def _consume_events(
        event_queue: asyncio.Queue[StreamEvent | object],
        prompt_task: asyncio.Task[None],
    ) -> AsyncIterator[StreamEvent]:
        # asyncio.wait so a finished/failed prompt is noticed while blocked on the queue; then drain to sentinel.
        get_event: asyncio.Task[StreamEvent | object] | None = None
        try:
            while True:
                get_event = asyncio.create_task(event_queue.get())
                done, _ = await asyncio.wait(
                    {get_event, prompt_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if get_event in done:
                    item = get_event.result()
                    get_event = None
                    if AcpClientHandler.is_sentinel(item):
                        # The prompt task may have failed just before finish()
                        # queued the sentinel; surface that real ACP error
                        # instead of letting the runtime report an empty stream.
                        prompt_task.result()
                        break
                    yield cast(StreamEvent, item)
                else:
                    get_event.cancel()
                    get_event = None
                    prompt_task.result()
                    while True:
                        item = await event_queue.get()
                        if AcpClientHandler.is_sentinel(item):
                            break
                        yield cast(StreamEvent, item)
                    break
        finally:
            if get_event and not get_event.done():
                get_event.cancel()

    @staticmethod
    async def _cancel_prompt_task(task: asyncio.Task[None] | None) -> None:
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, OSError):
                pass

    @staticmethod
    def _get_plan_mode_transition(event: StreamEvent) -> str | None:
        event_type = event.get("type", "")
        if event_type not in ("tool_completed", "tool_failed"):
            return None

        tool = event.get("tool", {})
        tool_name = tool.get("name", "")
        if tool_name == "EnterPlanMode":
            return "plan" if event_type == "tool_completed" else None
        if tool_name == "ExitPlanMode":
            permission_mode = tool.get("permission_mode")
            return permission_mode if isinstance(permission_mode, str) else None
        return None

    async def enhance_prompt(self, prompt: str, model_id: str, user: User) -> str:
        return (
            await self._generate_text(
                ENHANCE_PROMPT,
                "Enhance this prompt: " + prompt,
                model_id,
                user,
            )
            or prompt
        )

    async def generate_title(
        self, prompt: str, user: User, chat: Chat | None = None
    ) -> str | None:
        # Titles always run on the user's configured title model (settings),
        # never the chat's model — no fallback chain.
        try:
            user_settings = await self._get_user_settings(user.id)
            title = await self._generate_text(
                GENERATE_TITLE_SYSTEM_PROMPT,
                "Generate a title for this message:\n<message>\n"
                + prompt
                + "\n</message>",
                user_settings.title_model_id,
                user,
                chat=chat,
            )
            if title:
                title = title.strip().strip('"').strip("'")
            return title or None
        except AgentException as exc:
            logger.warning("Title generation failed for user %s: %s", user.id, exc)
            return None

    async def generate_pr_description(
        self, title: str, diff: str, model_id: str, user: User
    ) -> str:
        result = await self._generate_text(
            GENERATE_PR_DESCRIPTION_SYSTEM_PROMPT,
            GENERATE_PR_DESCRIPTION_TITLE_PREFIX + title + "\n\n" + diff,
            model_id,
            user,
        )
        if not result:
            raise AgentException("AI returned an empty description")
        return result

    async def generate_commit_message(
        self, diff: str, model_id: str, user: User
    ) -> str:
        result = await self._generate_text(
            GENERATE_COMMIT_MESSAGE_SYSTEM_PROMPT,
            diff,
            model_id,
            user,
        )
        if not result:
            raise AgentException("AI returned an empty commit message")
        return result

    async def answer_code_question(
        self,
        question: str,
        code: str,
        file_path: str | None,
        language: str | None,
        start_line: int | None,
        end_line: int | None,
        model_id: str,
        user: User,
        chat: Chat,
    ) -> str:
        # No file identity = chat-page text selection; label it accordingly so
        # the model doesn't hunt for a file.
        if file_path and language and start_line and end_line:
            line_ref = (
                str(start_line)
                if start_line == end_line
                else str(start_line) + "-" + str(end_line)
            )
            header = (
                "File: " + file_path + " (lines " + line_ref + ", " + language + ")"
            )
        else:
            header = "Selected text from the conversation:"
        # XML-ish wrapping instead of Markdown fences — snippets can contain
        # backtick runs that would close any fence we pick.
        user_message = (
            header + "\n"
            "<selection>\n" + code + "\n</selection>\n\n"
            "<question>\n" + question + "\n</question>"
        )
        result = await self._generate_text(
            INLINE_CHAT_SYSTEM_PROMPT, user_message, model_id, user, chat=chat
        )
        if not result:
            raise AgentException("AI returned an empty answer")
        return result

    async def _generate_text(
        self,
        system_prompt: str,
        user_message: str,
        model_id: str,
        user: User,
        chat: Chat | None = None,
    ) -> str:
        user_settings = await self._get_user_settings(user.id)
        agent_kind = MODELS[model_id].agent_kind

        if chat and chat.sandbox_id:
            sandbox_id = chat.sandbox_id
            sandbox_provider = SandboxProviderType(chat.sandbox_provider)
            workspace_path = chat.workspace_path
        else:
            # No chat/sandbox (title/commit-message/etc. one-shot calls). cwd is
            # irrelevant for these text-only tasks; use the app storage dir as a
            # stable workspace root.
            sandbox_id = ""
            sandbox_provider = SandboxProviderType.HOST
            workspace_path = settings.STORAGE_PATH

        # Pure text tasks — fully replace the agent's default coding persona so it
        # doesn't bleed into the output. Built via _build_acp_config so the system
        # prompt is actually delivered (Claude/Copilot systemPrompt _meta, Codex
        # model_instructions_file) and the model env override is set — a bare
        # AcpSessionConfig skips the adapter and sends neither.
        config = await self._build_acp_config(
            user_settings=user_settings,
            user_id=str(user.id),
            agent_kind=agent_kind,
            permission_mode=NORMAL_SESSION_MODE[agent_kind],
            model_id=model_id,
            session_id=None,
            sandbox_provider=sandbox_provider,
            sandbox_id=sandbox_id,
            workspace_path=workspace_path,
            system_prompt=system_prompt,
            system_prompt_is_full_replace=True,
        )

        try:
            session = await AcpSession.create(config)
        except AgentException:
            raise
        except asyncio.CancelledError:
            raise
        except Exception as e:
            raise AgentException(f"Failed to create ACP session: {e}") from e

        prompt_task: asyncio.Task[None] | None = None
        try:
            handler = session.handler
            prompt_task = asyncio.create_task(session.send_prompt(user_message))

            result_parts: list[str] = []
            async for event in self._consume_events(handler.event_queue, prompt_task):
                event_type = event.get("type")
                if event_type == "permission_request":
                    # Unattended text task — no UI to approve gated tool calls, so
                    # deny them instead of blocking forever on the permission
                    # future. The agent falls back to a text answer.
                    request_id = event.get("request_id")
                    if request_id:
                        handler.resolve_permission(request_id)
                elif event_type == "elicitation_request":
                    # Unattended text task — decline (not cancel) so the agent's
                    # tool proceeds with empty answers instead of aborting the
                    # tool use mid-task.
                    request_id = event.get("request_id")
                    if request_id:
                        handler.resolve_elicitation(request_id, action="decline")
                elif event_type == "assistant_text":
                    text = event.get("text", "")
                    if text:
                        result_parts.append(text)

            return "".join(result_parts)
        except asyncio.CancelledError:
            raise
        except AgentException:
            raise
        except Exception as e:
            raise AgentException(f"ACP call failed: {e}") from e
        finally:
            await self._cancel_prompt_task(prompt_task)
            await session.close()

    @staticmethod
    def _build_custom_env(user_settings: UserSettings) -> dict[str, str]:
        env: dict[str, str] = {}
        if user_settings.custom_env_vars:
            for env_var in user_settings.custom_env_vars:
                env[env_var["key"]] = env_var["value"]
        return env

    @staticmethod
    def _build_mcp_server_configs(
        chat_id: str | None, user_id: str, sandbox_provider: SandboxProviderType
    ) -> list[dict[str, Any]]:
        # Opt-in: hand the agent Agentrove's own chat tools over a stdio MCP server.
        if not settings.AGENTROVE_MCP_ENABLED:
            return []
        if sandbox_provider is SandboxProviderType.HOST:
            # Host-provider agents share this process's network namespace, but the
            # public BASE_URL is often unreachable from inside the deployment
            # (hairpin NAT), so point the MCP server at the local uvicorn instead.
            # Web mode listens on ${PORT:-8080}; desktop derives its port from a
            # loopback BASE_URL (desktop/entry.py).
            port = os.environ.get("PORT") or urlparse(settings.BASE_URL).port or 8080
            api_base = f"http://127.0.0.1:{port}"
        else:
            api_base = settings.BASE_URL
        env = {
            "AGENTROVE_API_URL": f"{api_base}{settings.API_V1_STR}",
            "AGENTROVE_ACCESS_TOKEN": create_mcp_access_token(user_id),
        }
        # The chat this session runs in — lets the agent create sub-threads under it
        if chat_id:
            env["AGENTROVE_CURRENT_CHAT_ID"] = chat_id
        return [
            {
                "name": "agentrove",
                # Spawn with the backend's own interpreter (the bundled sidecar
                # Python, which ships mcp+httpx) — avoids PATH/version surprises
                "command": sys.executable,
                "args": [str(MCP_SERVER_PATH)],
                "env": env,
            }
        ]

    async def _build_acp_config(
        self,
        *,
        user_settings: UserSettings,
        user_id: str,
        agent_kind: AgentKind,
        permission_mode: PermissionMode,
        model_id: str,
        session_id: str | None,
        chat_id: str | None = None,
        thinking_mode: str | None = None,
        cwd: str = "",
        sandbox_provider: SandboxProviderType,
        sandbox_id: str = "",
        workspace_path: str | None = None,
        system_prompt: str | None = None,
        system_prompt_is_full_replace: bool = False,
        fast_mode: bool = False,
    ) -> AcpSessionConfig:
        env: dict[str, str] = {}

        # claude-agent-acp hides the bypassPermissions session mode when running
        # as root unless IS_SANDBOX is set. Our agents always run inside an
        # isolated sandbox (Docker container or host sandbox dir), so force it on
        # — otherwise setting bypass mode fails on root deployments (e.g. VPS).
        env["IS_SANDBOX"] = "1"

        # Skip in desktop mode — host git credentials handle auth natively
        if user_settings.github_personal_access_token and not settings.DESKTOP_MODE:
            env["GITHUB_TOKEN"] = user_settings.github_personal_access_token
            env["GIT_ASKPASS"] = SandboxProvider.git_askpass_path(sandbox_provider)
        if settings.GIT_AUTHOR_NAME and settings.GIT_AUTHOR_EMAIL:
            env["GIT_AUTHOR_NAME"] = settings.GIT_AUTHOR_NAME
            env["GIT_AUTHOR_EMAIL"] = settings.GIT_AUTHOR_EMAIL
            env["GIT_COMMITTER_NAME"] = settings.GIT_AUTHOR_NAME
            env["GIT_COMMITTER_EMAIL"] = settings.GIT_AUTHOR_EMAIL

        env.update(self._build_custom_env(user_settings))

        adapter = AGENT_ADAPTERS[agent_kind]
        session_config = adapter.build_session_config(
            system_prompt=system_prompt,
            system_prompt_is_full_replace=system_prompt_is_full_replace,
            model_id=model_id,
            thinking_mode=thinking_mode,
            permission_mode=permission_mode,
        )
        env.update(session_config.env_overrides)

        return AcpSessionConfig(
            sandbox_id=sandbox_id,
            sandbox_provider=sandbox_provider,
            cwd=cwd,
            user_id=user_id,
            agent_kind=agent_kind,
            env=env,
            mcp_servers=self._build_mcp_server_configs(
                chat_id, user_id, sandbox_provider
            ),
            model=model_id,
            permission_mode=session_config.permission.session_mode,
            resume_session_id=session_id,
            workspace_path=workspace_path,
            system_prompt=system_prompt,
            system_prompt_is_full_replace=system_prompt_is_full_replace,
            reasoning_effort=session_config.reasoning_effort,
            session_meta=session_config.meta,
            fast_mode=fast_mode,
        )

    @staticmethod
    def prepare_user_prompt(
        prompt: str,
        custom_instructions: str | None,
    ) -> str:
        # Slash commands (e.g. /review) are passed through verbatim — the agent
        # runtime interprets them directly, so wrapping in XML tags would break them.
        if prompt.startswith("/"):
            return prompt

        parts = []
        if custom_instructions and custom_instructions.strip():
            parts.append(
                f"<user_instructions>\n{custom_instructions.strip()}\n</user_instructions>\n\n"
            )
        parts.append(f"<user_prompt>{prompt}</user_prompt>")
        return "".join(parts)
