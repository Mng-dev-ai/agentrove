import json
import logging
from typing import Any
from uuid import UUID

from app.constants import REDIS_KEY_USER_STREAMS_LIVE
from app.models.db_models.channel import Channel, ChannelMessage
from app.models.schemas.channel import ChannelMessageRead
from app.services.channels.state import ChannelState, TurnStatus
from app.utils.cache import CacheError, cache_connection

logger = logging.getLogger(__name__)


class ChannelPublisher:
    async def publish(
        self, channel: Channel, kind: str, payload: dict[str, Any]
    ) -> None:
        try:
            async with cache_connection() as cache:
                await cache.publish(
                    REDIS_KEY_USER_STREAMS_LIVE.format(user_id=channel.user_id),
                    json.dumps(
                        {"channelId": str(channel.id), "kind": kind, "payload": payload}
                    ),
                )
        except CacheError:
            logger.warning("Failed to publish channel event for %s", channel.id)

    async def publish_activity(
        self, state: ChannelState, asked: dict[str, str] | None = None
    ) -> None:
        member_ids = [
            str(turn.member.id)
            for turn in state.turns.values()
            if turn.status is TurnStatus.RUNNING
        ]
        waiting_member_ids = list(
            dict.fromkeys(
                str(member_id)
                for member_id, _ in [*state.permissions, *state.elicitations]
            )
        )
        elicitation_requests = list(state.elicitations.values())
        retrying_member_ids = [
            str(member_id)
            for member_id in state.retries
            if str(member_id) not in member_ids
        ]
        member_errors = {
            member_id: state.retries[UUID(member_id)].reason
            for member_id in retrying_member_ids
        }
        gave_up_members = {
            str(member_id): reason for member_id, reason in state.gave_up.items()
        }
        if (
            member_ids == state.active_member_ids
            and waiting_member_ids == state.waiting_member_ids
            and elicitation_requests == state.elicitation_requests
            and retrying_member_ids == state.retrying_member_ids
            and member_errors == state.member_errors
            and gave_up_members == state.gave_up_members
        ):
            return
        state.active_member_ids = member_ids
        state.waiting_member_ids = waiting_member_ids
        state.elicitation_requests = elicitation_requests
        state.retrying_member_ids = retrying_member_ids
        state.member_errors = member_errors
        state.gave_up_members = gave_up_members
        state.activity_version += 1
        activity = state.member_activity()
        if asked is not None:
            activity["asked"] = asked
        await self.publish(state.channel, "channel_member_activity", activity)

    @staticmethod
    def serialized(message: ChannelMessage) -> dict[str, Any]:
        payload: dict[str, Any] = ChannelMessageRead.model_validate(message).model_dump(
            mode="json"
        )
        return payload

    async def publish_message(self, channel: Channel, message: ChannelMessage) -> None:
        await self.publish(
            channel, "channel_message", {"message": self.serialized(message)}
        )
