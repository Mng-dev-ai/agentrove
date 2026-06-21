import logging
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.core.user_manager import optional_current_active_user
from app.db.session import SessionLocal, get_db
from app.models.db_models.chat import Chat
from app.models.db_models.workspace import Workspace
from app.models.db_models.user import User
from app.services.attachment import AttachmentService
from app.services.chat import ChatService
from app.services.agent import AgentService
from app.services.exceptions import ChatException, UserException
from app.services.git import GitService
from app.services.message import MessageService
from app.services.github import GitHubService
from app.services.queue import QueueService
from app.services.refresh_token import RefreshTokenService
from app.services.sandbox import SandboxService
from app.services.search import SearchService
from app.services.workspace import WorkspaceService
from app.services.sandbox_providers import SandboxProviderType
from app.services.sandbox_providers.base import SandboxProvider
from app.services.skill import SkillService
from app.services.user import UserService
from app.utils.cache import CacheError, cache_connection

logger = logging.getLogger(__name__)


def get_user_service() -> UserService:
    return UserService(session_factory=SessionLocal)


def get_refresh_token_service() -> RefreshTokenService:
    return RefreshTokenService(session_factory=SessionLocal)


def get_skill_service() -> SkillService:
    return SkillService()


async def get_github_token(
    user: User | None = Depends(optional_current_active_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> str | None:
    if user is None:
        return None
    try:
        user_settings = await user_service.get_user_settings(user.id, db=db)
        token = user_settings.github_personal_access_token
        return token if token else None
    except UserException:
        return None


async def require_github_token(
    github_token: str | None = Depends(get_github_token),
) -> str:
    if not github_token:
        raise HTTPException(
            status_code=400,
            detail="GitHub personal access token not configured",
        )
    return github_token


def get_github_service(
    github_token: str = Depends(require_github_token),
) -> GitHubService:
    return GitHubService(token=github_token)


def get_agent_service() -> AgentService:
    return AgentService(session_factory=SessionLocal)


async def validate_sandbox_ownership(
    sandbox_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> str:
    query = select(Workspace.sandbox_id).where(
        Workspace.sandbox_id == sandbox_id,
        Workspace.user_id == current_user.id,
        Workspace.deleted_at.is_(None),
    )
    result = await db.execute(query)
    if not result.one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sandbox not found",
        )
    return sandbox_id


async def get_sandbox_service(
    request: Request,
    user: User | None = Depends(optional_current_active_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> AsyncIterator[SandboxService]:
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    user_settings = await user_service.get_user_settings(user.id, db=db)

    sandbox_id = request.path_params.get("sandbox_id")
    if not sandbox_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="sandbox_id is required",
        )

    # Sandbox-scoped routes must use the provider persisted with that
    # workspace so requests never hit the wrong backend.
    query = select(Workspace.sandbox_provider, Workspace.workspace_path).where(
        Workspace.sandbox_id == sandbox_id,
        Workspace.user_id == user.id,
        Workspace.deleted_at.is_(None),
    )
    result = await db.execute(query)
    row = result.one_or_none()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sandbox not found",
        )

    provider = SandboxProvider.create_provider(
        SandboxProviderType(row.sandbox_provider),
        workspace_path=row.workspace_path,
    )

    env_vars = SandboxService.build_env_vars(
        user_settings.custom_env_vars,
        user_settings.github_personal_access_token,
    )

    try:
        yield SandboxService(provider, env_vars=env_vars)
    finally:
        await provider.cleanup()


def get_git_service(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GitService:
    return GitService(sandbox_service)


def get_search_service(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> SearchService:
    return SearchService(sandbox_service)


async def get_workspace_service(
    user_service: UserService = Depends(get_user_service),
) -> WorkspaceService:
    return WorkspaceService(
        user_service,
        session_factory=SessionLocal,
    )


def get_attachment_service() -> AttachmentService:
    return AttachmentService(
        message_service=MessageService(session_factory=SessionLocal)
    )


async def get_chat_service(
    user_service: UserService = Depends(get_user_service),
) -> AsyncIterator[ChatService]:
    yield ChatService(
        user_service,
        session_factory=SessionLocal,
    )


async def ensure_chat_access(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> Chat:
    try:
        return await chat_service.get_chat(chat_id, current_user)
    except ChatException:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found or access denied",
        )


async def get_queue_service() -> AsyncIterator[QueueService]:
    try:
        async with cache_connection() as cache:
            yield QueueService(cache)
    except CacheError as e:
        logger.error("Redis error: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        ) from e
