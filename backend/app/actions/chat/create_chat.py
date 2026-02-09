from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.db_models import Chat, User, UserSettings
from app.models.schemas import ChatCreate
from app.services.chat import ChatService


class CreateChatAction:
    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    async def execute(self, user: User, chat_data: ChatCreate) -> Chat:
        await self._chat_service.check_message_limit(user.id)

        user_settings = cast(
            UserSettings, await self._chat_service.user_service.get_user_settings(user.id)
        )
        self._chat_service.validate_api_keys(user_settings, chat_data.model_id)

        sandbox_id = await self._chat_service.sandbox_service.create_sandbox()

        await self._chat_service.sandbox_service.initialize_sandbox(
            sandbox_id=sandbox_id,
            github_token=user_settings.github_personal_access_token,
            custom_env_vars=user_settings.custom_env_vars,
            custom_skills=user_settings.custom_skills,
            custom_slash_commands=user_settings.custom_slash_commands,
            custom_agents=user_settings.custom_agents,
            user_id=str(user.id),
            auto_compact_disabled=user_settings.auto_compact_disabled,
            attribution_disabled=user_settings.attribution_disabled,
            custom_providers=user_settings.custom_providers,
            gmail_oauth_client=user_settings.gmail_oauth_client,
            gmail_oauth_tokens=user_settings.gmail_oauth_tokens,
        )

        async with self._chat_service.session_factory() as db:
            chat = Chat(
                title=self._chat_service.truncate_title(chat_data.title),
                user_id=user.id,
                sandbox_id=sandbox_id,
                sandbox_provider=user_settings.sandbox_provider,
            )

            db.add(chat)
            await db.commit()

            result = await db.execute(
                select(Chat).options(selectinload(Chat.messages)).filter(Chat.id == chat.id)
            )
            return result.scalar_one()
