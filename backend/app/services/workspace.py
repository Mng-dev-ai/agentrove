import asyncio
import contextlib
import logging
import math
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

from sqlalchemy import func, select, update

from app.constants import BUILTIN_SLASH_COMMANDS
from app.core.config import get_settings
from app.models.db_models.chat import Chat, Message
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.pagination import PaginatedResponse, PaginationParams
from app.models.schemas.workspace import (
    BuiltinSlashCommand,
    CustomSkill,
    Workspace as WorkspaceSchema,
    WorkspaceCreate,
    WorkspaceResources,
    WorkspaceUpdate,
)
from app.services.acp.adapters import AgentKind
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ErrorCode, WorkspaceException
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.base import SandboxProvider
from app.services.session_registry import session_registry
from app.services.skill import SkillService
from app.services.user import UserService

settings = get_settings()
logger = logging.getLogger(__name__)

WORKSPACES_DIR_NAME = "workspaces"
GIT_CLONE_TIMEOUT_SECONDS = 180


class WorkspaceService(BaseDbService[Workspace]):
    def __init__(
        self,
        user_service: UserService,
        session_factory: SessionFactoryType | None = None,
    ) -> None:
        super().__init__(session_factory)
        self.user_service = user_service
        self._base_dir = (Path(settings.STORAGE_PATH) / WORKSPACES_DIR_NAME).resolve()
        self._base_dir.mkdir(parents=True, exist_ok=True)

    async def create_workspace(self, user: User, data: WorkspaceCreate) -> Workspace:
        # Sandbox is provisioned before the DB insert so a persistence failure
        # can trigger teardown via the except block — never leave an orphan.
        user_settings = await self.user_service.get_user_settings(user.id)
        user_workspace_dir = (self._base_dir / str(user.id)).resolve()
        user_workspace_dir.mkdir(parents=True, exist_ok=True)

        # Desktop mode uses the host's native git credentials; token-based
        # auth is only needed inside Docker containers.
        github_token: str | None = (
            None
            if settings.DESKTOP_MODE
            else user_settings.github_personal_access_token
        )

        if data.source_type == "git":
            if not data.git_url:
                raise WorkspaceException(
                    "git_url is required for git workspace",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=400,
                )
            normalized_url = self._normalize_git_url(data.git_url)
            workspace_path = await self._clone_git_workspace(
                user_workspace_dir,
                normalized_url,
                github_token=github_token,
            )
            source_url = normalized_url
        elif data.source_type == "local":
            if not data.workspace_path:
                raise WorkspaceException(
                    "workspace_path is required for local workspace",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=400,
                )
            resolved = Path(data.workspace_path).expanduser().resolve()
            if not resolved.exists() or not resolved.is_dir():
                raise WorkspaceException(
                    "workspace_path must be an existing directory",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=400,
                )
            workspace_path = str(resolved)
            source_url = None
        else:
            workspace_dir = user_workspace_dir / f"{data.name}-{uuid4().hex[:8]}"
            workspace_dir.mkdir(parents=True, exist_ok=True)
            workspace_path = str(workspace_dir)
            source_url = None

        env_vars = SandboxService.build_env_vars(
            user_settings.custom_env_vars,
            github_token,
        )
        provider = SandboxProvider.create_provider(
            data.sandbox_provider,
            workspace_path=workspace_path,
        )
        sandbox_service = SandboxService(provider, env_vars=env_vars)

        sandbox_id = await sandbox_service.provider.create_sandbox(
            workspace_path=workspace_path,
        )

        await sandbox_service.initialize_sandbox(
            sandbox_id=sandbox_id,
            has_github_token=bool(github_token),
        )

        try:
            async with self._session_factory() as db:
                workspace = Workspace(
                    name=data.name,
                    user_id=user.id,
                    sandbox_id=sandbox_id,
                    sandbox_provider=data.sandbox_provider,
                    workspace_path=workspace_path,
                    source_type=data.source_type,
                    source_url=source_url,
                )
                db.add(workspace)
                await db.commit()
                await db.refresh(workspace)
                return workspace
        except Exception:
            # Broad catch so any persistence failure still triggers sandbox
            # teardown — otherwise we leak the container provisioned above.
            logger.error(
                "Failed to persist workspace, cleaning up sandbox %s", sandbox_id
            )
            asyncio.create_task(sandbox_service.delete_sandbox(sandbox_id))
            raise

    async def get_user_workspaces(
        self, user: User, pagination: PaginationParams | None = None
    ) -> PaginatedResponse[WorkspaceSchema]:
        # Annotates each workspace with chat_count and last_chat_at so the UI
        # can sort by recency in a single round trip.
        async with self._session_factory() as db:
            chat_count_col = func.count(Chat.id).label("chat_count")
            last_chat_at_col = func.max(Chat.updated_at).label("last_chat_at")

            query = (
                select(Workspace, chat_count_col, last_chat_at_col)
                .outerjoin(
                    Chat,
                    (Chat.workspace_id == Workspace.id)
                    & (Chat.deleted_at.is_(None))
                    & (Chat.parent_chat_id.is_(None)),
                )
                .filter(Workspace.user_id == user.id, Workspace.deleted_at.is_(None))
                .group_by(Workspace.id)
                .order_by(
                    func.max(Chat.updated_at).desc().nulls_last(),
                    Workspace.updated_at.desc(),
                )
            )

            if pagination:
                count_query = select(func.count(Workspace.id)).filter(
                    Workspace.user_id == user.id, Workspace.deleted_at.is_(None)
                )
                total = (await db.execute(count_query)).scalar() or 0
                offset = (pagination.page - 1) * pagination.per_page
                query = query.offset(offset).limit(pagination.per_page)
            else:
                total = None

            result = await db.execute(query)
            rows = result.all()
            workspace_schemas = []
            for workspace, chat_count, last_chat_at in rows:
                ws = WorkspaceSchema(
                    id=workspace.id,
                    name=workspace.name,
                    user_id=workspace.user_id,
                    sandbox_id=workspace.sandbox_id,
                    sandbox_provider=workspace.sandbox_provider,
                    workspace_path=workspace.workspace_path,
                    source_type=workspace.source_type,
                    source_url=workspace.source_url,
                    created_at=workspace.created_at,
                    updated_at=workspace.updated_at,
                )
                ws.chat_count = chat_count
                ws.last_chat_at = last_chat_at
                workspace_schemas.append(ws)

            if total is None:
                total = len(workspace_schemas)

            page = pagination.page if pagination else 1
            per_page = pagination.per_page if pagination else total or 1

            return PaginatedResponse[WorkspaceSchema](
                items=workspace_schemas,
                page=page,
                per_page=per_page,
                total=total,
                pages=math.ceil(total / per_page),
            )

    async def get_workspace(self, workspace_id: UUID, user: User) -> Workspace:
        async with self._session_factory() as db:
            result = await db.execute(
                select(Workspace).filter(
                    Workspace.id == workspace_id,
                    Workspace.user_id == user.id,
                    Workspace.deleted_at.is_(None),
                )
            )
            workspace: Workspace | None = result.scalar_one_or_none()
            if not workspace:
                raise WorkspaceException(
                    "Workspace not found",
                    error_code=ErrorCode.WORKSPACE_NOT_FOUND,
                    details={"workspace_id": str(workspace_id)},
                    status_code=404,
                )
            return workspace

    async def update_workspace(
        self, workspace_id: UUID, user: User, data: WorkspaceUpdate
    ) -> Workspace:
        # db.merge re-attaches the detached instance from get_workspace so
        # ORM-tracked mutations flush as an UPDATE.
        workspace = await self.get_workspace(workspace_id, user)
        async with self._session_factory() as db:
            managed: Workspace = await db.merge(workspace)
            if data.name is not None:
                managed.name = data.name
            await db.commit()
            return managed

    @staticmethod
    def _build_workspace_resources(
        skill_service: SkillService,
    ) -> WorkspaceResources:
        # Synchronous so the caller can offload to a thread — SkillService
        # does blocking filesystem reads.
        return WorkspaceResources(
            skills=[CustomSkill(**skill) for skill in skill_service.list_all()],
            builtin_slash_commands={
                kind.value: [
                    BuiltinSlashCommand(**cmd)
                    for cmd in BUILTIN_SLASH_COMMANDS.get(kind, [])
                ]
                for kind in AgentKind
            },
        )

    async def get_workspace_resources(
        self, workspace_id: UUID, user: User
    ) -> WorkspaceResources:
        # Thread-offloaded: SkillService walks the filesystem synchronously.
        workspace = await self.get_workspace(workspace_id, user)
        workspace_path = Path(workspace.workspace_path)
        skill_service = SkillService(workspace_path=workspace_path)

        return await asyncio.to_thread(self._build_workspace_resources, skill_service)

    async def delete_workspace(self, workspace_id: UUID, user: User) -> None:
        # DB commit lands before the session/sandbox teardown tasks so the DB
        # stays consistent even if those fire-and-forget cleanups fail.
        workspace = await self.get_workspace(workspace_id, user)
        async with self._session_factory() as db:
            workspace = await db.merge(workspace)
            now = datetime.now(timezone.utc)
            workspace.deleted_at = now

            # Soft-delete all chats in this workspace
            chat_ids_query = select(Chat.id).filter(
                Chat.workspace_id == workspace_id, Chat.deleted_at.is_(None)
            )
            chat_ids_result = await db.execute(chat_ids_query)
            chat_ids = [row[0] for row in chat_ids_result.fetchall()]

            await db.execute(
                update(Chat)
                .where(Chat.workspace_id == workspace_id, Chat.deleted_at.is_(None))
                .values(deleted_at=now)
            )

            # Soft-delete messages in those chats
            if chat_ids:
                await db.execute(
                    update(Message)
                    .where(
                        Message.chat_id.in_(chat_ids),
                        Message.deleted_at.is_(None),
                    )
                    .values(deleted_at=now)
                )

            await db.commit()

            # Terminate sessions for all chats
            for cid in chat_ids:
                asyncio.create_task(session_registry.terminate(str(cid)))

            # Destroy the container using the workspace's actual provider
            if workspace.sandbox_id:
                provider = SandboxProvider.create_provider(
                    workspace.sandbox_provider, workspace_path=workspace.workspace_path
                )
                sandbox_service = SandboxService(provider)
                asyncio.create_task(
                    sandbox_service.delete_sandbox(workspace.sandbox_id)
                )

    async def _clone_git_workspace(
        self,
        user_workspace_dir: Path,
        git_url: str,
        github_token: str | None = None,
    ) -> str:
        # Tokens go through a temporary GIT_ASKPASS script rather than the URL
        # or CLI args to keep them out of process listings and git's own logs.
        repo_name = self._extract_repo_name(git_url)
        workspace_dir = user_workspace_dir / f"{repo_name}-{uuid4().hex[:8]}"

        env = None
        askpass_path = None
        if github_token and git_url.startswith("https://"):
            parsed = urlparse(git_url)
            if parsed.hostname in ("github.com", "www.github.com"):
                fd, askpass_path = tempfile.mkstemp(prefix="git-askpass-", suffix=".sh")
                script = (
                    "#!/bin/sh\n"
                    'case "$1" in\n'
                    '*Username*) echo "x-access-token" ;;\n'
                    '*Password*) echo "$GIT_PASSWORD" ;;\n'
                    "esac\n"
                )
                os.write(fd, script.encode())
                os.close(fd)
                os.chmod(askpass_path, 0o700)
                env = {
                    **os.environ,
                    "GIT_ASKPASS": askpass_path,
                    "GIT_TERMINAL_PROMPT": "0",
                    "GIT_PASSWORD": github_token,
                }

        process = await asyncio.create_subprocess_exec(
            "git",
            "clone",
            "--depth",
            "1",
            # `--depth` implies `--single-branch`, which leaves only the default
            # branch's remote-tracking ref — the branch selector then has nothing
            # to list beyond `main`. Keep all branches visible at depth 1.
            "--no-single-branch",
            git_url,
            str(workspace_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=GIT_CLONE_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.wait()
            await asyncio.to_thread(shutil.rmtree, workspace_dir, True)
            raise WorkspaceException(
                "Git clone timed out",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            ) from exc
        finally:
            if askpass_path:
                with contextlib.suppress(OSError):
                    os.unlink(askpass_path)

        if process.returncode != 0:
            await asyncio.to_thread(shutil.rmtree, workspace_dir, True)
            error_output = (
                stderr.decode("utf-8", errors="replace").strip()
                or stdout.decode("utf-8", errors="replace").strip()
                or "Failed to clone repository"
            )
            if github_token:
                error_output = error_output.replace(github_token, "***")
            raise WorkspaceException(
                error_output,
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        return str(workspace_dir)

    @staticmethod
    def _normalize_git_url(git_url: str) -> str:
        # SSH passes through unmodified — auth is at the transport layer, not
        # the URL. HTTPS must not embed credentials (supplied via GIT_ASKPASS).
        candidate = git_url.strip()
        if not candidate:
            raise WorkspaceException(
                "git_url is required for git workspace",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        if candidate.startswith("git@"):
            return candidate

        parsed = urlparse(candidate)
        if parsed.scheme != "https":
            raise WorkspaceException(
                "git_url must be an HTTPS or git@... SSH URL",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )
        if parsed.username or parsed.password:
            raise WorkspaceException(
                "git_url must not contain embedded credentials",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )
        return candidate

    @staticmethod
    def _extract_repo_name(git_url: str) -> str:
        normalized = git_url.rstrip("/")
        if normalized.startswith("git@"):
            normalized = normalized.split(":", 1)[-1]
        else:
            normalized = urlparse(normalized).path
        raw_name = normalized.rsplit("/", 1)[-1]
        if raw_name.endswith(".git"):
            raw_name = raw_name[:-4]
        safe_name = "".join(
            char if char.isalnum() or char in {"-", "_"} else "-" for char in raw_name
        )
        safe_name = safe_name.strip("-")
        return safe_name or "workspace"
