from typing import Any
from uuid import UUID

from app.services.channel_publisher import ChannelPublisher
from app.services.channel_state import ChannelState, MemberTurn, TurnStatus
from app.services.db import SessionFactoryType
from app.services.push import PushService
from app.services.session_registry import session_registry


class ChannelRequests:
    def __init__(
        self, publisher: ChannelPublisher, session_factory: SessionFactoryType
    ) -> None:
        self.publisher = publisher
        self.session_factory = session_factory

    async def resolve_permissions(
        self, state: ChannelState, member_id: UUID, request_id: str | None = None
    ) -> None:
        for key in list(state.permissions):
            if key[0] == member_id and (request_id is None or key[1] == request_id):
                pending = state.permissions.pop(key)
                session_registry.resolve_permission(pending["chat_id"], key[1])
                await self.publisher.publish(
                    state.channel,
                    "channel_permission_resolved",
                    {"member_id": str(member_id), "request_id": key[1]},
                )
        await self.publisher.publish_activity(state)

    async def resolve_elicitations(
        self, state: ChannelState, member_id: UUID, request_id: str | None = None
    ) -> None:
        for key in list(state.elicitations):
            if key[0] == member_id and (request_id is None or key[1] == request_id):
                pending = state.elicitations.pop(key)
                session_registry.resolve_elicitation(
                    pending["chat_id"], key[1], action="cancel"
                )
        await self.publisher.publish_activity(state)

    async def request_permission(
        self, state: ChannelState, turn: MemberTurn, payload: dict[str, Any]
    ) -> None:
        async with state.lock:
            request_id = payload["request_id"]
            if turn.status is not TurnStatus.RUNNING:
                session_registry.resolve_permission(
                    str(turn.member.chat_id), request_id
                )
                return
            pending = {
                "member_id": str(turn.member.id),
                "chat_id": str(turn.member.chat_id),
                "request": {
                    "request_id": request_id,
                    "tool_name": payload["tool_name"],
                    "tool_input": payload["tool_input"],
                    "options": payload["data"]["options"],
                },
            }
            state.permissions[(turn.member.id, request_id)] = pending
            await self.publisher.publish(
                state.channel, "channel_permission_request", pending
            )
            await self.publisher.publish_activity(state)
        await PushService(self.session_factory).notify_permission(
            user_id=state.channel.user_id,
            path=f"/channels/{state.channel.id}",
            request_id=request_id,
            tool_name=payload["tool_name"],
            sub_thread=False,
        )

    async def request_elicitation(
        self, state: ChannelState, turn: MemberTurn, payload: dict[str, Any]
    ) -> None:
        async with state.lock:
            request_id = payload["request_id"]
            if turn.status is not TurnStatus.RUNNING:
                session_registry.resolve_elicitation(
                    str(turn.member.chat_id), request_id, action="decline"
                )
                return
            state.elicitations[(turn.member.id, request_id)] = {
                "member_id": str(turn.member.id),
                "chat_id": str(turn.member.chat_id),
                "request": {"request_id": request_id, **payload["data"]},
            }
            asked = {
                "title": f"#{state.channel.name}",
                "body": f"{turn.member.display_name} asks: {payload['data']['message']}",
            }
            await self.publisher.publish_activity(state, asked)
        await PushService(self.session_factory).notify_question(
            user_id=state.channel.user_id,
            path=f"/channels/{state.channel.id}",
            request_id=f"{turn.source_message_id}:{request_id}",
            title=asked["title"],
            body=asked["body"],
            sub_thread=False,
        )
