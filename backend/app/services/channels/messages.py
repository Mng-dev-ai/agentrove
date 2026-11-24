import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import Select, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models.channel import (
    Channel,
    ChannelDelivery,
    ChannelMember,
    ChannelMessage,
    ChannelMessageAttachment,
)
from app.models.db_models.chat import MessageAttachment
from app.models.schemas.channel import BROADCAST_MENTIONS
from app.models.types import MessageAttachmentDict
from app.services.channels.state import ChannelState
from app.services.db import BaseDbService
from app.services.pairing import PairingService
from app.utils.attachment_urls import AttachmentURL

MENTION = re.compile(r"(?:^|(?<=\s))@(\S+)")


class ChannelMessageStore(BaseDbService[ChannelMessage]):
    async def new_message(
        self,
        state: ChannelState,
        content: str,
        member_id: UUID | None = None,
        attachments: list[MessageAttachmentDict] | None = None,
        source_message_id: UUID | None = None,
        tool_call_count: int = 0,
        *,
        device_ids: frozenset[UUID],
    ) -> ChannelMessage:
        async with self.session_factory() as db:
            now = datetime.now(timezone.utc)
            await db.execute(
                update(Channel)
                .where(Channel.id == state.channel.id)
                .values(
                    Channel.touched_by_user(now)
                    if member_id is None
                    else {"updated_at": now}
                )
            )
            result = await db.execute(
                select(func.coalesce(func.max(ChannelMessage.seq), 0) + 1).where(
                    ChannelMessage.channel_id == state.channel.id
                )
            )
            seq = result.scalar_one()
            message = ChannelMessage(
                channel_id=state.channel.id,
                seq=seq,
                member_id=member_id,
                device_ids=device_ids,
                source_message_id=source_message_id,
                tool_call_count=tool_call_count,
                content=content,
                status="streaming" if member_id else "completed",
                audience=None
                if member_id
                else self.mentions(state.channel, content) or None,
                attachments=[
                    ChannelMessageAttachment(**attachment)
                    for attachment in attachments or []
                ],
            )
            db.add(message)
            await db.flush()
            for attachment in message.attachments:
                attachment.file_url = AttachmentURL.build_preview_url(attachment.id)
            await db.commit()
            state.channel.updated_at = now
        return message

    @staticmethod
    def mentions(
        channel: Channel, text: str, author_id: UUID | None = None
    ) -> list[str] | None:
        # None means @all/@everyone; an empty list means no member was mentioned.
        ids = {
            member.display_name.lower(): str(member.id) for member in channel.members
        }
        mentioned: set[str] = set()
        for match in MENTION.finditer(text):
            name = match[1].lower()
            while name not in ids and name[-1:] in (".", ",", ":", ";", "!", "?"):
                name = name[:-1]
            member_id = ids.get(name)
            if member_id is None and name in BROADCAST_MENTIONS:
                return None
            if member_id is not None and member_id != str(author_id):
                mentioned.add(member_id)
        return sorted(mentioned)

    @staticmethod
    def addressed(message: ChannelMessage, member: ChannelMember) -> bool:
        return message.audience is None or str(member.id) in message.audience

    @staticmethod
    def unseen(member: ChannelMember) -> Select[tuple[ChannelMessage]]:
        return (
            select(ChannelMessage)
            .where(
                ChannelMessage.channel_id == member.channel_id,
                ChannelMessage.status == "completed",
                ChannelMessage.member_id.is_(None)
                | (ChannelMessage.member_id != member.id),
                ~select(ChannelDelivery.member_id)
                .where(
                    ChannelDelivery.member_id == member.id,
                    ChannelDelivery.message_id == ChannelMessage.id,
                )
                .exists(),
            )
            .order_by(ChannelMessage.seq)
        )

    async def unseen_batch(
        self, db: AsyncSession, channel: Channel, member: ChannelMember
    ) -> list[ChannelMessage]:
        batch = list((await db.scalars(self.unseen(member))).all())
        active = await PairingService.active_device_ids(
            db,
            channel.user_id,
            frozenset().union(*(message.device_ids for message in batch)),
        )
        revoked = [message for message in batch if not message.device_ids <= active]
        if revoked:
            db.add_all(
                ChannelDelivery(member_id=member.id, message_id=message.id)
                for message in revoked
            )
            await db.commit()
        return [message for message in batch if message.device_ids <= active]

    @staticmethod
    async def write_message(
        db: AsyncSession, message: ChannelMessage, content: str, status: str
    ) -> None:
        message.content = content
        message.status = status
        message.version += 1
        await db.execute(
            update(ChannelMessage)
            .where(ChannelMessage.id == message.id)
            .values(
                content=content,
                status=status,
                version=message.version,
                tool_call_count=message.tool_call_count,
                duration_ms=message.duration_ms,
                audience=message.audience,
            )
            .execution_options(synchronize_session=False)
        )

    @staticmethod
    async def promote_attachments(db: AsyncSession, message: ChannelMessage) -> bool:
        promoted = set(
            await db.scalars(
                select(ChannelMessageAttachment.file_path).where(
                    ChannelMessageAttachment.message_id == message.id
                )
            )
        )
        added = [
            ChannelMessageAttachment(
                message_id=message.id,
                file_url="",
                file_path=attachment.file_path,
                file_type=attachment.file_type.value,
                filename=attachment.filename,
            )
            for attachment in await db.scalars(
                select(MessageAttachment)
                .where(MessageAttachment.message_id == message.source_message_id)
                .order_by(MessageAttachment.created_at, MessageAttachment.id)
            )
            if attachment.file_path not in promoted
        ]
        if not added:
            return False
        db.add_all(added)
        await db.flush()
        for attachment in added:
            attachment.file_url = AttachmentURL.build_preview_url(attachment.id)
        message.attachments = [*message.attachments, *added]
        return True
