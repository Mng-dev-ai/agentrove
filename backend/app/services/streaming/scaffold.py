from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from app.models.db_models.chat import Chat, ChatCheckpoint, Message
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.types import MessageAttachmentDict
from app.services.agent import AgentService
from app.services.db import SessionFactoryType
from app.services.exceptions import SandboxException
from app.services.git import GitService
from app.services.message import MessageService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.base import SandboxProvider

logger = logging.getLogger(__name__)


class TurnScaffold:
    @staticmethod
    async def create_checkpoint(
        chat: Chat,
        assistant_message_id: UUID,
        session_factory: SessionFactoryType,
        cwd: str,
    ) -> UUID | None:
        # Best-effort: a non-git workspace must not block the agent run.
        sandbox_id = chat.sandbox_id
        if not sandbox_id:
            return None

        try:
            provider = SandboxProvider.create_provider(
                chat.sandbox_provider, workspace_path=chat.workspace_path
            )
            checkpoint = await GitService(SandboxService(provider)).create_checkpoint(
                sandbox_id, cwd
            )
            if checkpoint is None:
                return None

            async with session_factory() as db:
                checkpoint_row = ChatCheckpoint(
                    chat_id=chat.id,
                    assistant_message_id=assistant_message_id,
                    cwd=cwd,
                    base_head=checkpoint.base_head,
                    head_ref=checkpoint.head_ref,
                    pre_run_diff=checkpoint.pre_run_diff,
                )
                db.add(checkpoint_row)
                await db.commit()
                await db.refresh(checkpoint_row)
                return cast(UUID, checkpoint_row.id)
        except (SandboxException, SQLAlchemyError, TimeoutError, ValueError) as exc:
            logger.warning(
                "Failed to create checkpoint for message %s: %s",
                assistant_message_id,
                exc,
            )
            return None

    @classmethod
    @asynccontextmanager
    async def open(
        cls,
        message_service: MessageService,
        chat: Chat,
        *,
        prompt: str,
        model_id: str,
        attachments: list[MessageAttachmentDict] | None,
        worktree: bool,
        base_branch: str | None,
        session_factory: SessionFactoryType,
        channel_member: bool = False,
        user_app_notice: str | None = None,
        user_message_id: UUID | None = None,
    ) -> AsyncIterator[tuple[Message, Message, UUID | None]]:
        # A turn that fails to start leaves no rows behind.
        user_message = None
        assistant_message = None
        try:
            chat_uuid = UUID(str(chat.id))
            user_message = await message_service.create_message(
                chat_uuid,
                prompt,
                MessageRole.USER,
                stream_status=MessageStreamStatus.COMPLETED,
                attachments=attachments,
                app_notice=user_app_notice,
                message_id=user_message_id,
            )
            assistant_message = await message_service.create_message(
                chat_uuid,
                "",
                MessageRole.ASSISTANT,
                model_id=model_id,
                stream_status=MessageStreamStatus.IN_PROGRESS,
            )
            checkpoint_id = None
            if not channel_member:
                # Resolved outside the best-effort checkpoint so a worktree that
                # can't be created fails the turn start; the checkpoint then
                # targets the same cwd the agent runs in.
                cwd = await AgentService(session_factory=session_factory).resolve_cwd(
                    chat, worktree, base_branch
                )
                checkpoint_id = await cls.create_checkpoint(
                    chat, assistant_message.id, session_factory, cwd
                )
            yield user_message, assistant_message, checkpoint_id
        except Exception as exc:
            logger.error("Turn failed to start for chat %s: %s", chat.id, exc)
            for message in (assistant_message, user_message):
                if message is not None:
                    await message_service.discard_message_quietly(message.id)
            raise
