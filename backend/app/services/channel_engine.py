import asyncio
import logging
import re
from collections.abc import Sequence
from datetime import datetime, timezone
from functools import partial
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Row, select, update
from sqlalchemy.orm import selectinload

from app.catalog import MODELS
from app.models.db_models.channel import (
    Channel,
    ChannelDelivery,
    ChannelMember,
    ChannelMessage,
    ChannelMessageAttachment,
)
from app.models.db_models.chat import Chat, Message, MessageAttachment
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.models.db_models.user import User
from app.models.schemas.chat import ChatRequest
from app.models.schemas.queue import QueuedChannelMessage
from app.models.types import MessageAttachmentDict
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.services.channel_messages import ChannelMessageStore
from app.services.channel_publisher import ChannelPublisher
from app.services.channel_requests import ChannelRequests
from app.services.channel_state import ChannelState, MemberRetry, MemberTurn, TurnStatus
from app.services.chat import ChatService
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ChatException
from app.services.push import PushService
from app.services.queue import ChannelQueueService
from app.services.session_registry import session_registry
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import ChannelMemberTurn
from app.services.user import UserService
from app.utils.cache import CacheError, cache_connection

logger = logging.getLogger(__name__)
DEBOUNCE_SECONDS = 2.5
QUEUE_RETRY_SECONDS = 5
REASON_LIMIT = 300
MAX_ATTEMPTS = 5

INTRODUCTION = (
    "You are {name}, a member of a group chat channel with the user and {others}. "
    "You share the same working directory with the other members. Before editing files, "
    "say what you're about to change, and don't edit files another member is working on. "
    'You will receive new channel messages as lines of "[author]: text". '
    "After each batch, either post ONE short chat message, or reply with exactly `PASS` (nothing else). "
    "Speak only when you add something new: answering a question nobody has answered well, "
    "disagreeing, correcting, giving a concrete proposal the others missed, "
    "or when the user addresses you or everyone. Otherwise reply `PASS`. "
    "Never echo or agree just to agree. When the discussion has reached a conclusion "
    "and nothing remains for you, reply `PASS`. Your reply is either exactly `PASS` "
    "or a chat message, never both. Write like Slack: short, no headers."
)
ROUTING_NOTE = (
    'A line like "[author → @name]: text" is addressed only to those members; '
    "the rest see it as context. Answer a line addressed to you when it asks a question "
    "or requests action or a decision from you; reply `PASS` when it is only an "
    "acknowledgment, non-actionable status note, or closing message, even when you're "
    "named. @mention a member only when you need something from them, never to acknowledge."
)


class ChannelEngine(BaseDbService[Channel]):
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        super().__init__(session_factory)
        self.chats = ChatService(
            UserService(self.session_factory), self.session_factory
        )
        self.messages = ChannelMessageStore(self.session_factory)
        self.publisher = ChannelPublisher()
        self.requests = ChannelRequests(self.publisher, self.session_factory)
        self.states: dict[UUID, ChannelState] = {}

    def state(self, channel: Channel) -> ChannelState:
        state = self.states.get(channel.id)
        if state is None:
            raise HTTPException(404, "Channel not found")
        return state

    def register(self, channel: Channel) -> None:
        self.states[channel.id] = ChannelState(channel)

    def drop(self, channel: Channel) -> None:
        self.states.pop(channel.id, None)

    @staticmethod
    def reset_member(state: ChannelState, member_id: UUID) -> None:
        state.retries.pop(member_id, None)
        state.gave_up.pop(member_id, None)

    @classmethod
    def forget_member(cls, state: ChannelState, member_id: UUID) -> None:
        state.turns.pop(member_id, None)
        cls.reset_member(state, member_id)

    @staticmethod
    def member_busy(state: ChannelState, member_id: UUID) -> bool:
        turn = state.turns.get(member_id)
        return turn is not None and turn.task is not None and not turn.task.done()

    @staticmethod
    def clear_introducing(state: ChannelState) -> None:
        for turn in state.turns.values():
            turn.introducing = False

    def reply_audience(self, state: ChannelState, turn: MemberTurn) -> list[str] | None:
        member_id = str(turn.member.id)
        explicit = self.messages.mentions(state.channel, turn.text, turn.member.id)
        if explicit is None or explicit:
            return explicit
        audience: set[str] = set()
        for message in turn.batch:
            if not self.messages.addressed(message, turn.member):
                continue
            if message.audience is None:
                return None
            audience.update(message.audience)
            if message.member_id is not None:
                audience.add(str(message.member_id))
        audience.discard(member_id)
        return sorted(audience)

    def fan_out(self, state: ChannelState) -> None:
        state.quiet_until = asyncio.get_running_loop().time() + DEBOUNCE_SECONDS
        self.schedule(state)

    def schedule(self, state: ChannelState, retry_at: float = 0) -> None:
        if state.timer is not None:
            state.timer.cancel()
            state.timer = None
        if not state.paused and not state.deleted:
            state.timer = asyncio.create_task(self.wake(state, retry_at))
            state.timer.add_done_callback(self.task_done)

    @staticmethod
    def task_done(task: asyncio.Task[None]) -> None:
        if not task.cancelled() and (error := task.exception()) is not None:
            logger.error("Channel task failed", exc_info=error)

    async def send(
        self,
        state: ChannelState,
        content: str,
        attachments: list[MessageAttachmentDict],
        device_ids: frozenset[UUID],
    ) -> ChannelMessage:
        message = await self.messages.new_message(
            state, content, attachments=attachments, device_ids=device_ids
        )
        await self.publisher.publish_message(state.channel, message)
        self.fan_out(state)
        return message

    async def post(
        self,
        channel: Channel,
        content: str,
        attachments: list[MessageAttachmentDict],
        device_ids: frozenset[UUID],
    ) -> ChannelMessage:
        state = self.state(channel)
        async with state.control:
            turns: list[MemberTurn] = []
            try:
                async with state.lock:
                    if state.deleted:
                        raise HTTPException(404, "Channel not found")
                    state.paused = True
                    state.last_reply = None
                    audience = self.messages.mentions(state.channel, content) or None
                    turns = [
                        turn
                        for turn in state.turns.values()
                        if audience is None or str(turn.member.id) in audience
                    ]
                    state.give_fresh_attempts(audience)
                    await self.cancel_active(state, turns)
                    message = await self.send(state, content, attachments, device_ids)
            finally:
                try:
                    await self.cancel_turns(turns)
                finally:
                    async with state.lock:
                        state.paused = False
                        self.schedule(state)
            return message

    async def cancel_active(self, state: ChannelState, turns: list[MemberTurn]) -> None:
        for turn in turns:
            if turn.status is not TurnStatus.FINISHED:
                turn.status = TurnStatus.CANCELLED
                await self.finish(state, turn)
            if turn.task is not None and turn.task.done():
                state.turns.pop(turn.member.id)
        await self.publisher.publish_activity(state)

    async def cancel_device_turns(self, device_ids: frozenset[UUID]) -> None:
        for state in list(self.states.values()):
            async with state.lock:
                turns = [
                    turn
                    for turn in state.turns.values()
                    if turn.device_ids & device_ids
                ]
                if turns:
                    await self.cancel_active(state, turns)
            await self.cancel_turns(turns)

    async def cancel_turns(self, turns: list[MemberTurn]) -> None:
        await asyncio.gather(
            *(
                ChatStreamRuntime.cancel_chat_turn(str(turn.member.chat_id), timeout=10)
                for turn in turns
            )
        )

    async def wake(self, state: ChannelState, retry_at: float = 0) -> None:
        await asyncio.sleep(
            max(0, max(state.quiet_until, retry_at) - asyncio.get_running_loop().time())
        )
        async with state.lock:
            state.timer = None
            if state.paused or state.deleted:
                return
            retry_times = []
            now = asyncio.get_running_loop().time()
            for member in state.channel.members:
                if member.model_id not in MODELS:
                    if member.id not in state.unavailable:
                        logger.warning(
                            "Skipping channel member %s: unknown model %s",
                            member.id,
                            member.model_id,
                        )
                        state.unavailable.add(member.id)
                    continue
                retry = state.retries.get(member.id)
                if retry is not None and retry.until > now:
                    retry_times.append(retry.until)
                    continue
                previous = state.turns.get(member.id)
                if previous is not None and (
                    previous.status is not TurnStatus.FAILED
                    or (previous.task is not None and not previous.task.done())
                ):
                    continue
                try:
                    if previous is not None:
                        await self.finish(state, previous)
                        state.turns.pop(member.id)
                    if member.id in state.gave_up:
                        continue
                    async with self.session_factory() as db:
                        batch = await self.messages.unseen_batch(
                            db, state.channel, member
                        )
                        if not any(
                            self.messages.addressed(message, member)
                            for message in batch
                        ):
                            continue
                except Exception as exc:
                    if member.id not in state.gave_up:
                        self.backoff(state, member, exc)
                    if member.id in state.gave_up:
                        state.turns.pop(member.id, None)
                    else:
                        retry_times.append(state.retries[member.id].until)
                    continue
                turn = MemberTurn(member, batch, introducing=not member.introduced)
                state.turns[member.id] = turn
                turn.task = asyncio.create_task(self.run_turn(state, turn))
                turn.task.add_done_callback(self.task_done)
            await self.publisher.publish_activity(state)
            if retry_times:
                self.schedule(state, min(retry_times))
            completion = await self.settle(state)
            await self.send_next_queued(state)
        if completion is not None:
            message_id, title, body = completion
            await PushService(self.session_factory).notify_channel_completion(
                user_id=state.channel.user_id,
                channel_id=state.channel.id,
                message_id=message_id,
                title=title,
                body=body,
            )

    async def send_next_queued(self, state: ChannelState) -> None:
        if not state.idle():
            return
        channel_id = str(state.channel.id)
        try:
            async with cache_connection() as cache:
                queue = ChannelQueueService(cache)
                item = await queue.pop_next_message(channel_id)
                if item is None:
                    return
                try:
                    queued = QueuedChannelMessage.model_validate(item)
                    message = await self.messages.new_message(
                        state,
                        queued.content,
                        attachments=item["attachments"] or [],
                        device_ids=queued.device_ids,
                    )
                except Exception:
                    await queue.requeue_message(channel_id, item)
                    logger.warning(
                        "Failed to send queued message for channel %s",
                        channel_id,
                        exc_info=True,
                    )
                    # The channel is idle, so nothing else would wake it to retry.
                    self.schedule(
                        state, asyncio.get_running_loop().time() + QUEUE_RETRY_SECONDS
                    )
                    return
        except CacheError:
            logger.warning("Failed to read queued messages for channel %s", channel_id)
            return
        state.give_fresh_attempts(message.audience)
        await self.publisher.publish_activity(state)
        await self.publisher.publish_message(state.channel, message)
        self.fan_out(state)
        await self.publisher.publish(
            state.channel, "channel_queue_sent", {"id": item["id"]}
        )

    async def settle(self, state: ChannelState) -> tuple[UUID, str, str] | None:
        if state.last_reply is None or not state.idle():
            return None
        author, message = state.last_reply
        state.last_reply = None
        title = f"#{state.channel.name}"
        body = f"{author}: {message.content.strip() or 'Open the channel to see the result.'}"
        state.activity_version += 1
        await self.publisher.publish(
            state.channel,
            "channel_member_activity",
            {
                **state.member_activity(),
                "completed": {"title": title, "body": body},
            },
        )
        return message.id, title, body

    async def dispatch_queued(self, channel: Channel) -> None:
        state = self.state(channel)
        async with state.lock:
            await self.send_next_queued(state)

    async def send_queued_now(
        self,
        channel: Channel,
        queue: ChannelQueueService,
        message_id: UUID,
        device_ids: frozenset[UUID],
    ) -> ChannelMessage:
        channel_id = str(channel.id)
        item = await queue.delete_message(channel_id, str(message_id))
        if item is None:
            raise HTTPException(404, "Queued message not found")
        queue.add_devices(item, device_ids)
        try:
            message = await self.post(
                channel,
                item["content"],
                item["attachments"] or [],
                QueuedChannelMessage.model_validate(item).device_ids,
            )
        except Exception:
            await queue.requeue_message(channel_id, item)
            raise
        await self.publisher.publish(channel, "channel_queue_sent", {"id": item["id"]})
        return message

    def backoff(
        self, state: ChannelState, member: ChannelMember, error: object
    ) -> None:
        previous = state.retries.pop(member.id, None)
        attempts = previous.attempts + 1 if previous else 1
        if attempts >= MAX_ATTEMPTS:
            state.gave_up[member.id] = (
                f"Gave up after {attempts} attempts: {self.reason(error)}"
            )
            logger.warning(
                "Channel member %s failed; gave up after %s attempts: %s",
                member.id,
                attempts,
                error,
            )
            return
        delay = min(previous.delay * 2, 300) if previous else 5
        state.retries[member.id] = MemberRetry(
            delay,
            asyncio.get_running_loop().time() + delay,
            self.reason(error),
            attempts,
        )
        logger.warning(
            "Channel member %s failed; retrying in %ss: %s", member.id, delay, error
        )

    @staticmethod
    def reason(error: object) -> str:
        lines = str(error).strip().splitlines()
        reason = lines[0].strip() if lines else type(error).__name__
        if len(reason) > REASON_LIMIT:
            return f"{reason[: REASON_LIMIT - 1]}…"
        return reason

    def fail_turn(self, state: ChannelState, turn: MemberTurn, error: object) -> None:
        if turn.status not in (TurnStatus.FAILED, TurnStatus.FINISHED):
            turn.status = TurnStatus.FAILED
            self.backoff(state, turn.member, error)

    def prompt(self, state: ChannelState, turn: MemberTurn) -> str:
        names = {member.id: member.display_name for member in state.channel.all_members}
        lines = [
            f"[{self.label(message, names)}]: {message.content}"
            for message in turn.batch
        ]
        if any(message.audience is not None for message in turn.batch):
            lines.insert(0, ROUTING_NOTE)
        if turn.introducing:
            others = (
                ", ".join(
                    member.display_name
                    for member in state.channel.members
                    if member.id != turn.member.id
                )
                or "no other agents"
            )
            lines.insert(
                0, INTRODUCTION.format(name=turn.member.display_name, others=others)
            )
        return "\n".join(lines)

    @staticmethod
    def label(message: ChannelMessage, names: dict[UUID, str]) -> str:
        author = names[message.member_id] if message.member_id else "user"
        if message.audience is None:
            return author
        targets = [f"@{names[UUID(member_id)]}" for member_id in message.audience]
        return f"{author} → {', '.join(targets) or 'user'}"

    async def run_turn(self, state: ChannelState, turn: MemberTurn) -> None:
        member = turn.member
        # Batches combine validated messages and can exceed the single-message limit.
        request = ChatRequest.model_construct(
            chat_id=member.chat_id,
            model_id=member.model_id,
            prompt=self.prompt(state, turn),
            permission_mode=member.permission_mode,
            thinking_mode=member.thinking_mode,
            selected_persona_name=member.persona or DEFAULT_PERSONA_NAME,
        )
        attachments = [
            MessageAttachmentDict(
                file_url=attachment.file_url,
                file_path=attachment.file_path,
                file_type=attachment.file_type,
                filename=attachment.filename,
            )
            for message in turn.batch
            for attachment in message.attachments
        ]
        member_turn = ChannelMemberTurn(
            event_sink=partial(self.handle_event, state, turn),
            task_started=turn.started,
            attachments=attachments,
        )
        try:
            while turn.status is TurnStatus.RUNNING:
                try:
                    await self.chats.initiate_chat_completion(
                        request,
                        User(id=state.channel.user_id),
                        device_ids=turn.device_ids,
                        member_turn=member_turn,
                    )
                    break
                except ChatException as exc:
                    if exc.status_code != 409:
                        raise
                    await asyncio.sleep(0.1)
            if turn.provider_task is not None:
                if turn.status is not TurnStatus.RUNNING:
                    await ChatStreamRuntime.cancel_chat_turn(
                        str(member.chat_id), timeout=10
                    )
                await turn.provider_task
        except asyncio.CancelledError:
            if turn.status is TurnStatus.RUNNING:
                turn.status = TurnStatus.CANCELLED
            raise
        except Exception as exc:
            if turn.status is TurnStatus.RUNNING:
                self.fail_turn(state, turn, exc)
        finally:
            async with state.lock:
                try:
                    await self.finish(state, turn)
                except Exception as exc:
                    self.fail_turn(state, turn, exc)
                else:
                    state.turns.pop(member.id)
                await self.publisher.publish_activity(state)
                self.schedule(state)

    @staticmethod
    def normalized(text: str) -> str:
        wrappers = "`*\"' \t\r\n"
        return text.strip().strip(wrappers).removesuffix(".").strip().strip(wrappers)

    @classmethod
    def is_silent(cls, text: str) -> bool:
        lines = []
        fence = ""
        for line in text.splitlines():
            if fence:
                if re.fullmatch(
                    r" {0,3}" + fence[0] + "{" + str(len(fence)) + r",}\s*", line
                ):
                    fence = ""
                continue
            if match := re.match(r"^ {0,3}(`{3,}|~{3,})", line):
                fence = match[1]
                continue
            if line.expandtabs(4).startswith("    "):
                continue
            if normalized := cls.normalized(line):
                lines.append(normalized)
        if not lines:
            return not cls.normalized(text)
        if len(lines) == 1 and "PASS".startswith(lines[0].upper()):
            return True
        return (
            any(
                line.lower() == "pass"
                or re.match(r"^PASS(?:\s*[—–:(,.!]|\s+-\s)", line) is not None
                or re.match(r"^pass[,.]\s", line, re.IGNORECASE) is not None
                for line in (lines[0], lines[-1])
            )
            or re.search(r"(?:^|[.!?;—–)]\s*)PASS\.?$", lines[-1]) is not None
        )

    async def text(self, state: ChannelState, turn: MemberTurn, delta: str) -> None:
        async with state.lock:
            if turn.status is not TurnStatus.RUNNING:
                return
            if turn.reset_segment:
                turn.text = ""
                turn.reset_segment = False
            turn.text += delta
            if turn.message is None and self.is_silent(turn.text):
                return
            delay = turn.last_flush_at + 0.2 - asyncio.get_running_loop().time()
            if delay <= 0:
                await self.flush(state, turn)
            elif turn.flush_task is None:
                turn.flush_task = asyncio.create_task(
                    self.flush_later(state, turn, delay)
                )
                turn.flush_task.add_done_callback(self.task_done)

    async def flush_later(
        self, state: ChannelState, turn: MemberTurn, delay: float
    ) -> None:
        await asyncio.sleep(delay)
        async with state.lock:
            turn.flush_task = None
            if turn.status is TurnStatus.RUNNING:
                await self.flush(state, turn)

    async def flush(self, state: ChannelState, turn: MemberTurn) -> None:
        if turn.message is None:
            await self.begin_speaking(state, turn)
        else:
            async with self.session_factory() as db:
                turn.message.tool_call_count = len(turn.tool_call_ids)
                await self.messages.write_message(
                    db,
                    turn.message,
                    "" if self.is_silent(turn.text) else turn.text,
                    "streaming",
                )
                await db.commit()
            await self.publisher.publish_message(state.channel, turn.message)
        turn.last_flush_at = asyncio.get_running_loop().time()

    async def begin_speaking(self, state: ChannelState, turn: MemberTurn) -> None:
        turn.message = await self.messages.new_message(
            state,
            "" if self.is_silent(turn.text) else turn.text,
            turn.member.id,
            source_message_id=turn.source_message_id,
            tool_call_count=len(turn.tool_call_ids),
            device_ids=turn.device_ids,
        )
        async with self.session_factory() as db:
            await self.messages.promote_attachments(db, turn.message)
            await db.commit()
        await self.publisher.publish_message(state.channel, turn.message)

    async def attachment_saved(self, chat: Chat, source_message_id: UUID) -> None:
        state = self.states.get(chat.channel_id) if chat.channel_id else None
        if state is None:
            return
        async with state.lock:
            if state.deleted:
                return
            member = next(m for m in state.channel.all_members if m.chat_id == chat.id)
            turn = state.turns.get(member.id)
            if (
                turn is None
                or turn.status is TurnStatus.FINISHED
                or turn.source_message_id != source_message_id
            ):
                await self.show_late_attachments(state, member.id, source_message_id)
            elif turn.message is None:
                await self.begin_speaking(state, turn)
            else:
                async with self.session_factory() as db:
                    promoted = await self.messages.promote_attachments(db, turn.message)
                    await db.commit()
                if promoted and turn.status is TurnStatus.RUNNING:
                    await self.flush(state, turn)

    async def show_late_attachments(
        self, state: ChannelState, member_id: UUID, source_message_id: UUID
    ) -> None:
        async with self.session_factory() as db:
            reply = await db.scalar(
                select(ChannelMessage).where(
                    ChannelMessage.source_message_id == source_message_id
                )
            )
            stream_status = await db.scalar(
                select(Message.stream_status).where(Message.id == source_message_id)
            )
        if reply is None:
            reply = await self.messages.new_message(
                state,
                "",
                member_id,
                source_message_id=source_message_id,
                device_ids=frozenset(),
            )
        async with self.session_factory() as db:
            await self.messages.promote_attachments(db, reply)
            await self.messages.write_message(
                db,
                reply,
                reply.content,
                "completed"
                if stream_status is MessageStreamStatus.COMPLETED
                else "cancelled",
            )
            await db.commit()
        await self.publisher.publish_message(state.channel, reply)

    async def finish(self, state: ChannelState, turn: MemberTurn) -> None:
        if turn.status is TurnStatus.FINISHED:
            return
        await self.requests.resolve_permissions(state, turn.member.id)
        await self.requests.resolve_elicitations(state, turn.member.id)
        successful = turn.status is TurnStatus.RUNNING
        silent = self.is_silent(turn.text)
        if turn.message is None and successful and not silent:
            await self.begin_speaking(state, turn)
        message = turn.message
        async with self.session_factory() as db:
            if successful:
                db.add_all(
                    ChannelDelivery(member_id=turn.member.id, message_id=message.id)
                    for message in turn.batch
                )
            if message is not None:
                message.tool_call_count = len(turn.tool_call_ids)
                await self.messages.promote_attachments(db, message)
                # A PASS that attached files stays visible: the user should see them.
                silent = silent and not message.attachments
                if silent:
                    await self.messages.write_message(db, message, "", "deleted")
                else:
                    if turn.source_message_id is not None:
                        duration_ms, created_at = (
                            await db.execute(
                                select(Message.duration_ms, Message.created_at).where(
                                    Message.id == turn.source_message_id
                                )
                            )
                        ).one()
                        message.duration_ms = (
                            duration_ms
                            if duration_ms is not None
                            else int(
                                (
                                    datetime.now(timezone.utc) - created_at
                                ).total_seconds()
                                * 1000
                            )
                        )
                    if successful:
                        message.audience = self.reply_audience(state, turn)
                    await self.messages.write_message(
                        db,
                        message,
                        "" if self.is_silent(turn.text) else turn.text,
                        "completed" if successful else "cancelled",
                    )
                if not silent and successful:
                    now = datetime.now(timezone.utc)
                    await db.execute(
                        update(Channel)
                        .where(Channel.id == state.channel.id)
                        .values(updated_at=now)
                    )
                    state.channel.updated_at = now
            await db.commit()
        turn.status = TurnStatus.FINISHED
        if successful:
            state.retries.pop(turn.member.id, None)
        if message is not None:
            await self.publisher.publish_message(state.channel, message)
            if successful and not silent:
                if state.last_reply is None or message.seq > state.last_reply[1].seq:
                    state.last_reply = (turn.member.display_name, message)
                self.fan_out(state)

    async def stop_state(self, state: ChannelState) -> None:
        async with state.lock:
            state.paused = True
            if state.timer is not None:
                state.timer.cancel()
                state.timer = None
            state.retries.clear()
            state.last_reply = None
            turns = list(state.turns.values())
            await self.cancel_active(state, turns)
            async with self.session_factory() as db:
                for member in state.channel.members:
                    batch = list((await db.scalars(self.messages.unseen(member))).all())
                    db.add_all(
                        ChannelDelivery(member_id=member.id, message_id=message.id)
                        for message in batch
                    )
                await db.commit()
        await self.cancel_turns(turns)

    async def teardown(self, state: ChannelState) -> None:
        state.deleted = True
        await self.stop_state(state)
        tasks = [turn.task for turn in state.turns.values() if turn.task is not None]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for member in state.channel.members:
            await session_registry.terminate(str(member.chat_id))

    async def stop(self, channel: Channel) -> None:
        state = self.state(channel)
        async with state.control:
            try:
                await self.stop_state(state)
            finally:
                state.paused = False

    async def recover_messages(
        self,
    ) -> tuple[
        list[ChannelMessage],
        Sequence[Row[tuple[UUID, UUID, UUID]]],
        list[Channel],
    ]:
        async with self.session_factory() as db:
            messages = list(
                (
                    await db.scalars(
                        select(ChannelMessage).where(
                            ChannelMessage.status == "streaming"
                        )
                    )
                ).all()
            )
            for message in messages:
                await self.messages.promote_attachments(db, message)
                silent = self.is_silent(message.content) and not message.attachments
                await self.messages.write_message(
                    db,
                    message,
                    "" if silent else message.content,
                    "deleted" if silent else "cancelled",
                )
            await db.commit()
            orphans = (
                await db.execute(
                    select(ChannelMember.channel_id, ChannelMember.id, Message.id)
                    .join(Message, Message.chat_id == ChannelMember.chat_id)
                    .join(MessageAttachment, MessageAttachment.message_id == Message.id)
                    .outerjoin(
                        ChannelMessage, ChannelMessage.source_message_id == Message.id
                    )
                    .outerjoin(
                        ChannelMessageAttachment,
                        (ChannelMessageAttachment.message_id == ChannelMessage.id)
                        & (
                            ChannelMessageAttachment.file_path
                            == MessageAttachment.file_path
                        ),
                    )
                    .where(
                        Message.role == MessageRole.ASSISTANT,
                        ChannelMessageAttachment.id.is_(None),
                    )
                    .distinct()
                )
            ).all()
            channels = list(
                (
                    await db.scalars(
                        select(Channel).options(selectinload(Channel.all_members))
                    )
                ).all()
            )
        return messages, orphans, channels

    async def resume(
        self,
        channel: Channel,
        messages: list[ChannelMessage],
        orphans: Sequence[Row[tuple[UUID, UUID, UUID]]],
    ) -> None:
        state = ChannelState(channel)
        self.states[channel.id] = state
        for message in messages:
            if message.channel_id == channel.id:
                await self.publisher.publish_message(channel, message)
        for channel_id, member_id, source_message_id in orphans:
            if channel_id == channel.id:
                await self.show_late_attachments(state, member_id, source_message_id)
        self.fan_out(state)

    async def shutdown(self) -> None:
        for state in self.states.values():
            async with state.lock:
                state.paused = True
                if state.timer is not None:
                    state.timer.cancel()
                await self.cancel_active(state, list(state.turns.values()))
        await asyncio.gather(
            *(
                self.cancel_turns(list(state.turns.values()))
                for state in self.states.values()
            )
        )
        tasks = [
            turn.task
            for state in self.states.values()
            for turn in state.turns.values()
            if turn.task is not None
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def handle_event(
        self, state: ChannelState, turn: MemberTurn, kind: str, payload: dict[str, Any]
    ) -> None:
        # Provider output confirms delivery; bootstrap failures must not consume the introduction.
        if turn.introducing and kind in (
            "assistant_text",
            "assistant_thinking",
            "tool_started",
            "tool_completed",
            "tool_failed",
        ):
            async with state.lock:
                if turn.introducing:
                    async with self.session_factory() as db:
                        await db.execute(
                            update(ChannelMember)
                            .where(ChannelMember.id == turn.member.id)
                            .values(introduced=True)
                        )
                        await db.commit()
                    turn.member.introduced = True
                    turn.introducing = False
        if kind == "stream_started":
            turn.source_message_id = UUID(payload["message_id"])
        elif kind == "permission_request":
            await self.requests.request_permission(state, turn, payload)
        elif kind == "permission_resolved":
            async with state.lock:
                await self.requests.resolve_permissions(
                    state, turn.member.id, payload["request_id"]
                )
        elif kind == "elicitation_request":
            await self.requests.request_elicitation(state, turn, payload)
        elif kind == "elicitation_resolved":
            async with state.lock:
                await self.requests.resolve_elicitations(
                    state, turn.member.id, payload["request_id"]
                )
        elif kind == "assistant_text":
            await self.text(state, turn, payload["text"])
        elif kind in ("tool_started", "tool_completed", "tool_failed"):
            async with state.lock:
                if turn.status is TurnStatus.RUNNING:
                    turn.tool_call_ids.add(payload["tool"]["id"])
                    if kind == "tool_started":
                        turn.reset_segment = True
        elif kind == "error" and turn.status is TurnStatus.RUNNING:
            self.fail_turn(state, turn, payload["error"])
        elif kind == "cancelled" and turn.status is TurnStatus.RUNNING:
            turn.status = TurnStatus.CANCELLED


channel_engine = ChannelEngine()
