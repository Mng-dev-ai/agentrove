from app.models.db_models import User
from app.models.schemas import UserUsage
from app.services.user import UserService


class GetUserUsageAction:
    def __init__(self, user_service: UserService) -> None:
        self._user_service = user_service

    async def execute(self, current_user: User) -> UserUsage:
        messages_used = await self._user_service.get_user_daily_message_count(
            current_user.id
        )
        messages_remaining = await self._user_service.get_remaining_messages(
            current_user.id
        )

        return UserUsage(
            messages_used_today=messages_used,
            daily_message_limit=current_user.daily_message_limit,
            messages_remaining=messages_remaining,
        )
