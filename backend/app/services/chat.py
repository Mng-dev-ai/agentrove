import asyncio
import logging
import math
from datetime import datetime, timezone
from typing import cast
from uuid import UUID

from celery.result import AsyncResult
from sqlalchemy import exists, func, select, update
from sqlalchemy.orm import selectinload

from app.constants import REDIS_KEY_CHAT_TASK
from app.core.config import get_settings
from app.models.db_models import (
    Chat,
    Message,
    MessageAttachment,
    MessageRole,
    MessageStreamStatus,
    User,
    UserSettings,
)
from app.models.schemas import (
    ChatCreate,
    ChatRequest,
    ChatUpdate,
    CursorPaginatedMessages,
    PaginatedChats,
    PaginationParams,
    ProviderType,
)
from app.models.types import ChatCompletionResult, MessageAttachmentDict
from app.prompts.system_prompt import build_system_prompt_for_chat
from app.services.base import BaseDbService, SessionFactoryType
from app.services.provider import ProviderService
from app.services.claude_agent import ClaudeAgentService
from app.services.exceptions import ChatException, ErrorCode
from app.services.message import MessageService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import (
    DockerConfig,
    LocalDockerProvider,
    SandboxProviderType,
)
from app.services.storage import StorageService
from app.services.user import UserService
from app.tasks.chat_processor import process_chat
from app.utils.message_events import extract_user_prompt_and_reviews
from app.utils.redis import redis_connection
from app.utils.validators import APIKeyValidationError, validate_model_api_keys

settings = get_settings()
logger = logging.getLogger(__name__)

CHAT_TITLE_MAX_LENGTH = 50


class ChatService(BaseDbService[Chat]):
    def __init__(
        self,
        storage_service: StorageService,
        sandbox_service: SandboxService,
        ai_service: ClaudeAgentService,
        user_service: UserService,
        session_factory: SessionFactoryType | None = None,
    ) -> None:
        super().__init__(session_factory)
        self.sandbox_service = sandbox_service
        self.ai_service = ai_service
        self.storage_service = storage_service
        self.user_service = user_service
        self.message_service = MessageService(session_factory=self._session_factory)
        self._provider_service = ProviderService()

    @property
    def session_factory(self) -> SessionFactoryType:
        return self._session_factory

    @session_factory.setter
    def session_factory(self, value: SessionFactoryType) -> None:
        self._session_factory = value
        self.message_service.session_factory = value

    async def get_user_chats(
        self, user: User, pagination: PaginationParams | None = None
    ) -> PaginatedChats:
        if pagination is None:
            pagination = PaginationParams()

        async with self.session_factory() as db:
            count_query = select(func.count(Chat.id)).filter(
                Chat.user_id == user.id, Chat.deleted_at.is_(None)
            )
            count_result = await db.execute(count_query)
            total = count_result.scalar()

            offset = (pagination.page - 1) * pagination.per_page

            query = (
                select(Chat)
                .filter(Chat.user_id == user.id, Chat.deleted_at.is_(None))
                .order_by(Chat.pinned_at.desc().nulls_last(), Chat.updated_at.desc())
                .offset(offset)
                .limit(pagination.per_page)
            )
            result = await db.execute(query)
            chats = result.scalars().all()

            return PaginatedChats(
                items=chats,
                page=pagination.page,
                per_page=pagination.per_page,
                total=total,
                pages=math.ceil(total / pagination.per_page) if total > 0 else 0,
            )

    async def create_chat(self, user: User, chat_data: ChatCreate) -> Chat:
        await self._check_message_limit(user.id)

        user_settings = cast(
            UserSettings, await self.user_service.get_user_settings(user.id)
        )
        self._validate_api_keys(user_settings, chat_data.model_id)

        sandbox_id = await self.sandbox_service.create_sandbox()

        github_token = user_settings.github_personal_access_token
        custom_env_vars = user_settings.custom_env_vars
        custom_skills = user_settings.custom_skills
        custom_slash_commands = user_settings.custom_slash_commands
        custom_agents = user_settings.custom_agents
        auto_compact_disabled = user_settings.auto_compact_disabled
        attribution_disabled = user_settings.attribution_disabled
        custom_providers = user_settings.custom_providers

        await self.sandbox_service.initialize_sandbox(
            sandbox_id=sandbox_id,
            github_token=github_token,
            custom_env_vars=custom_env_vars,
            custom_skills=custom_skills,
            custom_slash_commands=custom_slash_commands,
            custom_agents=custom_agents,
            user_id=str(user.id),
            auto_compact_disabled=auto_compact_disabled,
            attribution_disabled=attribution_disabled,
            custom_providers=custom_providers,
        )

        async with self.session_factory() as db:
            chat = Chat(
                title=self._truncate_title(chat_data.title),
                user_id=user.id,
                sandbox_id=sandbox_id,
                sandbox_provider=user_settings.sandbox_provider,
            )

            db.add(chat)
            await db.commit()

            query = (
                select(Chat)
                .options(selectinload(Chat.messages))
                .filter(Chat.id == chat.id)
            )
            result = await db.execute(query)
            loaded_chat: Chat = result.scalar_one()

            return loaded_chat

    async def update_chat(
        self, chat_id: UUID, chat_update: ChatUpdate, user: User
    ) -> Chat:
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat).filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            chat: Chat | None = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to update it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            if chat_update.title is not None:
                chat.title = self._truncate_title(chat_update.title)

            if chat_update.pinned is not None:
                chat.pinned_at = (
                    datetime.now(timezone.utc) if chat_update.pinned else None
                )

            chat.updated_at = datetime.now(timezone.utc)
            await db.commit()

            return chat

    async def get_chat(self, chat_id: UUID, user: User) -> Chat:
        async with self.session_factory() as db:
            query = (
                select(Chat)
                .filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
                .options(
                    selectinload(
                        Chat.messages.and_(Message.deleted_at.is_(None))
                    ).selectinload(Message.attachments)
                )
            )
            result = await db.execute(query)
            chat: Chat | None = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to access it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            return chat

    async def delete_chat(self, chat_id: UUID, user: User) -> None:
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat).filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
            )
            chat = result.scalar_one_or_none()

            if not chat:
                raise ChatException(
                    "Chat not found or you don't have permission to delete it",
                    error_code=ErrorCode.CHAT_NOT_FOUND,
                    details={"chat_id": str(chat_id)},
                    status_code=404,
                )

            now = datetime.now(timezone.utc)
            chat.deleted_at = now

            messages_update = (
                update(Message)
                .where(Message.chat_id == chat_id, Message.deleted_at.is_(None))
                .values(deleted_at=now)
            )
            await db.execute(messages_update)

            await db.commit()

            if chat.sandbox_id:
                await self.sandbox_service.delete_sandbox(chat.sandbox_id)

    async def get_chat_sandbox_id(self, chat_id: UUID, user: User) -> str | None:
        async with self.session_factory() as db:
            result = await db.execute(
                select(Chat)
                .filter(
                    Chat.id == chat_id,
                    Chat.user_id == user.id,
                    Chat.deleted_at.is_(None),
                )
                .with_only_columns(Chat.sandbox_id)
            )
            row = result.one_or_none()

            if not row:
                raise ChatException(
                    "Chat not found or you don't have permission to access sandbox",
                    error_code=ErrorCode.CHAT_ACCESS_DENIED,
                    details={"chat_id": str(chat_id)},
                    status_code=403,
                )

            sandbox_id_value: str | None = row[0]
            return sandbox_id_value

    async def verify_sandbox_access(self, sandbox_id: str, user_id: UUID) -> bool:
        async with self.session_factory() as db:
            query = select(
                exists().where(
                    Chat.sandbox_id == sandbox_id,
                    Chat.user_id == user_id,
                    Chat.deleted_at.is_(None),
                )
            )
            result = await db.execute(query)
            return bool(result.scalar())

    async def sandbox_exists(self, sandbox_id: str) -> bool:
        async with self.session_factory() as db:
            query = select(
                exists().where(
                    Chat.sandbox_id == sandbox_id,
                    Chat.deleted_at.is_(None),
                )
            )
            result = await db.execute(query)
            return bool(result.scalar())

    async def delete_all_chats(self, user: User) -> int:
        async with self.session_factory() as db:
            sandbox_query = select(Chat.sandbox_id).filter(
                Chat.user_id == user.id,
                Chat.sandbox_id.isnot(None),
                Chat.deleted_at.is_(None),
            )
            result = await db.execute(sandbox_query)
            sandbox_ids = [row[0] for row in result.fetchall()]

            now = datetime.now(timezone.utc)

            chats_update = (
                update(Chat)
                .where(Chat.user_id == user.id, Chat.deleted_at.is_(None))
                .values(deleted_at=now)
            )
            await db.execute(chats_update)

            messages_update = (
                update(Message)
                .where(
                    Message.chat_id.in_(
                        select(Chat.id).filter(Chat.user_id == user.id)
                    ),
                    Message.deleted_at.is_(None),
                )
                .values(deleted_at=now)
            )
            await db.execute(messages_update)

            await db.commit()

            for sandbox_id in sandbox_ids:
                await self.sandbox_service.delete_sandbox(sandbox_id)

            return len(sandbox_ids)

    async def get_chat_messages(
        self, chat_id: UUID, user: User, cursor: str | None = None, limit: int = 20
    ) -> CursorPaginatedMessages:
        has_access = await self._verify_chat_access(chat_id, user.id)
        if not has_access:
            raise ChatException(
                "Chat not found or you don't have permission to access messages",
                error_code=ErrorCode.CHAT_ACCESS_DENIED,
                details={"chat_id": str(chat_id)},
                status_code=403,
            )

        asyncio.create_task(self._resume_sandbox(chat_id, user))

        return await self.message_service.get_chat_messages(chat_id, cursor, limit)

    async def initiate_chat_completion(
        self,
        request: ChatRequest,
        current_user: User,
    ) -> ChatCompletionResult:
        if not request.chat_id:
            raise ChatException(
                "chat_id is required for chat completion",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        await self._check_message_limit(current_user.id)

        user_settings = await self.user_service.get_user_settings(current_user.id)
        self._validate_api_keys(user_settings, request.model_id)

        chat = await self.get_chat(request.chat_id, current_user)

        chat_id = chat.id

        attachments: list[MessageAttachmentDict] | None = None
        if request.attached_files:
            attachments = list(
                await asyncio.gather(
                    *[
                        self.storage_service.save_file(
                            file,
                            sandbox_id=chat.sandbox_id,
                            user_id=str(current_user.id),
                        )
                        for file in request.attached_files
                    ]
                )
            )

        try:
            user_prompt, reviews_text = extract_user_prompt_and_reviews(request.prompt)
            ai_prompt = user_prompt + reviews_text
        except (ValueError, KeyError, TypeError, AttributeError) as e:
            logger.error("Failed to parse review comments: %s", e)
            user_prompt = request.prompt or ""
            ai_prompt = user_prompt

        await self.message_service.create_message(
            chat_id,
            request.prompt,
            MessageRole.USER,
            attachments=attachments,
        )

        # When switching from OpenRouter to Claude, we need to clean thinking blocks from the session.
        # OpenRouter models (via anthropic-bridge) generate thinking blocks with empty signatures.
        # Claude API validates signatures and rejects invalid ones with:
        # "Invalid signature in thinking block"
        # We strip these invalid thinking blocks while preserving the rest of the conversation context.
        session_id = chat.session_id
        if session_id and chat.sandbox_id:
            if await self._needs_session_cleaning(
                chat.id, request.model_id, current_user.id
            ):
                await self.sandbox_service.clean_session_thinking_blocks(
                    chat.sandbox_id, session_id
                )

        assistant_message = await self._create_assistant_message(chat, request.model_id)

        system_prompt = build_system_prompt_for_chat(
            chat.sandbox_id or "",
            user_settings,
            selected_prompt_name=request.selected_prompt_name,
        )
        is_custom_prompt = bool(request.selected_prompt_name)
        custom_instructions = (
            user_settings.custom_instructions if user_settings else None
        )

        try:
            task = await self._enqueue_chat_task(
                prompt=ai_prompt,
                system_prompt=system_prompt,
                custom_instructions=custom_instructions,
                user=current_user,
                chat=chat,
                permission_mode=request.permission_mode,
                model_id=request.model_id,
                session_id=session_id,
                assistant_message_id=str(assistant_message.id),
                thinking_mode=request.thinking_mode,
                attachments=attachments,
                is_custom_prompt=is_custom_prompt,
            )

            await self._store_active_task(chat_id, task.id)
        except Exception as e:
            logger.error("Failed to enqueue chat task: %s", e)
            await self.message_service.soft_delete_message(assistant_message.id)
            raise

        return {
            "task_id": task.id,
            "message_id": str(assistant_message.id),
            "chat_id": str(chat_id),
            "status": "started",
        }

    async def get_chat_by_sandbox_id(
        self, sandbox_id: str, user_id: UUID
    ) -> Chat | None:
        async with self.session_factory() as db:
            query = select(Chat).filter(
                Chat.sandbox_id == sandbox_id,
                Chat.user_id == user_id,
                Chat.deleted_at.is_(None),
            )
            result = await db.execute(query)
            chat: Chat | None = result.scalar_one_or_none()
            return chat

    async def restore_to_checkpoint(
        self, chat_id: UUID, message_id: UUID, current_user: User
    ) -> None:
        chat = await self.get_chat(chat_id, current_user)
        sandbox_id = chat.sandbox_id

        async with self.session_factory() as db:
            result = await db.execute(select(Message).filter(Message.id == message_id))
            message = result.scalar_one_or_none()

            if not message or message.chat_id != chat_id:
                raise ChatException(
                    "Message not found for this chat",
                    error_code=ErrorCode.MESSAGE_NOT_FOUND,
                    details={"message_id": str(message_id), "chat_id": str(chat_id)},
                    status_code=404,
                )

            if sandbox_id and message.checkpoint_id:
                await self.sandbox_service.restore_checkpoint(
                    sandbox_id, str(message.id)
                )

            await self.message_service.delete_messages_after(chat_id, message)

            update_stmt = (
                update(Chat)
                .where(Chat.id == chat_id)
                .values(session_id=message.session_id)
            )
            await db.execute(update_stmt)
            await db.commit()

    async def fork_chat(
        self, source_chat_id: UUID, message_id: UUID, user: User
    ) -> tuple[Chat, int]:
        source_chat = await self.get_chat(source_chat_id, user)

        if not source_chat.sandbox_id:
            raise ChatException(
                "Source chat has no sandbox",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        messages = await self.message_service.get_messages_up_to(
            source_chat_id, message_id
        )
        if not messages:
            raise ChatException(
                "No messages to fork",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        target_message = messages[-1]

        user_settings = cast(
            UserSettings, await self.user_service.get_user_settings(user.id)
        )

        sandbox_provider = user_settings.sandbox_provider
        if sandbox_provider != "docker":
            raise ChatException(
                "Fork is only supported with Docker sandbox provider",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        docker_config = DockerConfig(
            image=settings.DOCKER_IMAGE,
            network=settings.DOCKER_NETWORK,
            host=settings.DOCKER_HOST,
            preview_base_url=settings.DOCKER_PREVIEW_BASE_URL,
            sandbox_domain=settings.DOCKER_SANDBOX_DOMAIN,
            traefik_network=settings.DOCKER_TRAEFIK_NETWORK,
        )
        provider = LocalDockerProvider(config=docker_config)
        fork_sandbox_service = SandboxService(provider)

        try:
            new_sandbox_id = await fork_sandbox_service.clone_sandbox(
                source_chat.sandbox_id,
                checkpoint_id=target_message.checkpoint_id,
            )

            try:
                await fork_sandbox_service.initialize_sandbox(
                    sandbox_id=new_sandbox_id,
                    custom_providers=user_settings.custom_providers,
                    is_fork=True,
                )

                async with self.session_factory() as db:
                    new_chat = Chat(
                        title=self._truncate_title(f"Fork of {source_chat.title}"),
                        user_id=user.id,
                        sandbox_id=new_sandbox_id,
                        sandbox_provider=SandboxProviderType.DOCKER.value,
                        session_id=target_message.session_id,
                    )
                    db.add(new_chat)
                    await db.flush()

                    new_messages: list[Message] = []
                    msg_to_attachments: list[
                        tuple[Message, list[MessageAttachment]]
                    ] = []
                    for msg in messages:
                        new_message = Message(
                            chat_id=new_chat.id,
                            content=msg.content,
                            role=msg.role,
                            model_id=msg.model_id,
                            session_id=msg.session_id,
                            checkpoint_id=msg.checkpoint_id,
                            stream_status=msg.stream_status,
                            total_cost_usd=msg.total_cost_usd,
                        )
                        new_messages.append(new_message)
                        msg_to_attachments.append((new_message, list(msg.attachments)))

                    db.add_all(new_messages)
                    await db.flush()

                    all_attachments: list[MessageAttachment] = []
                    for new_message, orig_attachments in msg_to_attachments:
                        for att in orig_attachments:
                            new_attachment = MessageAttachment(
                                message_id=new_message.id,
                                file_url="",
                                file_path=att.file_path,
                                file_type=att.file_type,
                                filename=att.filename,
                            )
                            all_attachments.append(new_attachment)

                    if all_attachments:
                        db.add_all(all_attachments)
                        await db.flush()
                        for att in all_attachments:
                            att.file_url = f"{settings.BASE_URL}/api/v1/attachments/{att.id}/preview"

                    await db.commit()
                    await db.refresh(new_chat)

                return (new_chat, len(messages))

            except Exception:
                try:
                    await fork_sandbox_service.delete_sandbox(new_sandbox_id)
                except Exception:
                    pass
                raise
        finally:
            await provider.cleanup()

    async def _verify_chat_access(self, chat_id: UUID, user_id: UUID) -> bool:
        async with self.session_factory() as db:
            query = select(
                exists().where(
                    Chat.id == chat_id,
                    Chat.user_id == user_id,
                    Chat.deleted_at.is_(None),
                )
            )
            result = await db.execute(query)
            return bool(result.scalar())

    def _truncate_title(self, title: str) -> str:
        if len(title) <= CHAT_TITLE_MAX_LENGTH:
            return title
        return title[:CHAT_TITLE_MAX_LENGTH] + "..."

    async def _check_message_limit(self, user_id: UUID) -> None:
        can_continue = await self.user_service.check_message_limit(user_id)
        if not can_continue:
            raise ChatException(
                "Daily message limit exceeded. You have reached your daily message limit.",
                error_code=ErrorCode.CHAT_DAILY_LIMIT_EXCEEDED,
                details={"user_id": str(user_id)},
                status_code=429,
            )

    def _validate_api_keys(self, user_settings: UserSettings, model_id: str) -> None:
        try:
            validate_model_api_keys(user_settings, model_id)
        except APIKeyValidationError as e:
            raise ChatException(
                str(e), error_code=ErrorCode.API_KEY_MISSING, status_code=400
            ) from e

    async def _create_assistant_message(self, chat: Chat, model_id: str) -> Message:
        return await self.message_service.create_message(
            chat.id,
            "",
            MessageRole.ASSISTANT,
            model_id=model_id,
            stream_status=MessageStreamStatus.IN_PROGRESS,
        )

    async def _enqueue_chat_task(
        self,
        *,
        prompt: str,
        system_prompt: str,
        custom_instructions: str | None,
        user: User,
        chat: Chat,
        permission_mode: str,
        model_id: str,
        session_id: str | None,
        assistant_message_id: str,
        thinking_mode: str | None,
        attachments: list[MessageAttachmentDict] | None,
        is_custom_prompt: bool = False,
    ) -> "AsyncResult[object]":
        return process_chat.delay(
            prompt=prompt,
            system_prompt=system_prompt,
            custom_instructions=custom_instructions,
            chat_data={
                "id": str(chat.id),
                "user_id": str(chat.user_id),
                "title": chat.title,
                "sandbox_id": chat.sandbox_id,
                "session_id": chat.session_id,
            },
            permission_mode=permission_mode,
            model_id=model_id,
            session_id=session_id,
            assistant_message_id=assistant_message_id,
            thinking_mode=thinking_mode,
            attachments=attachments,
            is_custom_prompt=is_custom_prompt,
        )

    async def _store_active_task(self, chat_id: UUID, task_id: str) -> None:
        async with redis_connection() as redis:
            await redis.setex(
                REDIS_KEY_CHAT_TASK.format(chat_id=chat_id),
                settings.TASK_TTL_SECONDS,
                task_id,
            )

    async def _resume_sandbox(self, chat_id: UUID, user: User) -> None:
        try:
            sandbox_id = await self.get_chat_sandbox_id(chat_id, user)
            if sandbox_id:
                await self.sandbox_service.get_or_connect_sandbox(sandbox_id)
        except ChatException:
            pass
        except Exception as e:
            logger.warning("Failed to resume sandbox for chat %s: %s", chat_id, e)

    async def _needs_session_cleaning(
        self, chat_id: UUID, new_model_id: str, user_id: UUID
    ) -> bool:
        user_settings = await self.user_service.get_user_settings(user_id)
        if not user_settings:
            return False

        new_provider, _ = self._provider_service.get_provider_for_model(
            user_settings, new_model_id
        )
        new_provider_type = new_provider.get("provider_type") if new_provider else None

        if new_provider_type != "anthropic":
            return False

        last_message = await self.message_service.get_latest_assistant_message(chat_id)
        if not last_message or not last_message.model_id:
            return False

        prev_provider, _ = self._provider_service.get_provider_for_model(
            user_settings, last_message.model_id
        )
        prev_provider_type = (
            prev_provider.get("provider_type") if prev_provider else None
        )

        if prev_provider_type != ProviderType.ANTHROPIC.value:
            logger.info(
                "Session cleaning needed for chat %s: switching from %s to %s",
                chat_id,
                prev_provider_type,
                new_provider_type,
            )
            return True

        return False
