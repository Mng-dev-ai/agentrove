from uuid import UUID

from fastapi import Request
from sse_starlette.sse import EventSourceResponse

from app.models.db_models import User
from app.services.chat import ChatService


class StreamEventsAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    @staticmethod
    def _parse_non_negative_seq(value: str | None) -> int:
        if value is None:
            return 0
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 0
        return parsed if parsed >= 0 else 0

    async def execute(
        self,
        chat_id: UUID,
        request: Request,
        current_user: User,
    ) -> EventSourceResponse:
        await self._chat_service.get_chat(chat_id, current_user)

        # Browser EventSource reconnects send the current cursor via Last-Event-ID.
        # Keep query-param baseline support and use whichever is more advanced.
        after_seq = max(
            self._parse_non_negative_seq(request.query_params.get("after_seq")),
            self._parse_non_negative_seq(request.headers.get("Last-Event-ID")),
        )

        return EventSourceResponse(
            self._chat_service.create_event_stream(chat_id, after_seq),
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
