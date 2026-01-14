#!/usr/bin/env python3
import asyncio
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.models.db_models.ai_model import AIModel
from app.models.db_models.enums import ModelProvider
from app.models.db_models.user import User, UserSettings

SEED_MODELS = [
    {
        "model_id": "claude-opus-4-5-20251101",
        "name": "Claude Opus 4.5",
        "provider": ModelProvider.ANTHROPIC,
        "sort_order": 0,
    },
    {
        "model_id": "claude-sonnet-4-5",
        "name": "Claude Sonnet 4.5",
        "provider": ModelProvider.ANTHROPIC,
        "sort_order": 1,
    },
    {
        "model_id": "claude-haiku-4-5",
        "name": "Claude Haiku 4.5",
        "provider": ModelProvider.ANTHROPIC,
        "sort_order": 2,
    },
    {
        "model_id": "glm-4.7",
        "name": "GLM 4.7",
        "provider": ModelProvider.ZAI,
        "sort_order": 3,
    },
    {
        "model_id": "glm-4.6",
        "name": "GLM 4.6",
        "provider": ModelProvider.ZAI,
        "sort_order": 4,
    },
    {
        "model_id": "glm-4.5-air",
        "name": "GLM 4.5 Air",
        "provider": ModelProvider.ZAI,
        "sort_order": 5,
    },
    {
        "model_id": "openai/gpt-5.2",
        "name": "GPT-5.2",
        "provider": ModelProvider.OPENROUTER,
        "sort_order": 6,
    },
    {
        "model_id": "openai/gpt-5.1-codex",
        "name": "GPT-5.1 Codex",
        "provider": ModelProvider.OPENROUTER,
        "sort_order": 7,
    },
    {
        "model_id": "x-ai/grok-code-fast-1",
        "name": "Grok Code Fast",
        "provider": ModelProvider.OPENROUTER,
        "sort_order": 8,
    },
    {
        "model_id": "moonshotai/kimi-k2-thinking",
        "name": "Kimi K2 Thinking",
        "provider": ModelProvider.OPENROUTER,
        "sort_order": 9,
    },
    {
        "model_id": "minimax/minimax-m2",
        "name": "Minimax M2",
        "provider": ModelProvider.OPENROUTER,
        "sort_order": 10,
    },
    {
        "model_id": "deepseek/deepseek-v3.2",
        "name": "Deepseek V3.2",
        "provider": ModelProvider.OPENROUTER,
        "sort_order": 11,
    },
    {
        "model_id": "google/gemini-3-flash-preview",
        "name": "Gemini 3 Flash Preview",
        "provider": ModelProvider.OPENROUTER,
        "sort_order": 12,
    },
    {
        "model_id": "google/gemini-3-pro-preview",
        "name": "Gemini 3 Pro Preview",
        "provider": ModelProvider.OPENROUTER,
        "sort_order": 13,
    },
]


async def seed_models(session: AsyncSession) -> None:
    for model_data in SEED_MODELS:
        result = await session.execute(
            select(AIModel).where(AIModel.model_id == model_data["model_id"])
        )
        existing = result.scalar_one_or_none()

        if existing:
            print(f"Model '{model_data['model_id']}' already exists, skipping")
            continue

        model = AIModel(
            model_id=model_data["model_id"],
            name=model_data["name"],
            provider=model_data["provider"],
            sort_order=model_data["sort_order"],
            is_active=True,
        )
        session.add(model)
        print(f"Added model: {model_data['name']} ({model_data['model_id']})")


async def seed_admin(session: AsyncSession) -> None:
    result = await session.execute(select(User).where(User.is_superuser.is_(True)))
    existing_admin = result.scalar_one_or_none()

    if existing_admin:
        print(f"Admin account already exists: {existing_admin.email}")
        settings_result = await session.execute(
            select(UserSettings).where(UserSettings.user_id == existing_admin.id)
        )
        if not settings_result.scalar_one_or_none():
            admin_settings = UserSettings(user_id=existing_admin.id)
            session.add(admin_settings)
            print(f"Added missing settings for admin: {existing_admin.email}")
        return

    admin_email = os.getenv("ADMIN_EMAIL", "admin@example.com")
    admin_username = os.getenv("ADMIN_USERNAME", "admin")
    admin_password = os.getenv("ADMIN_PASSWORD", "admin123")

    admin_user = User(
        email=admin_email,
        username=admin_username,
        hashed_password=get_password_hash(admin_password),
        is_active=True,
        is_superuser=True,
        is_verified=True,
    )
    session.add(admin_user)
    await session.flush()

    admin_settings = UserSettings(user_id=admin_user.id)
    session.add(admin_settings)
    print(f"Added admin account: {admin_email}")


async def seed_data() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session() as session:
        await seed_models(session)
        await seed_admin(session)
        await session.commit()
        print("Seed completed successfully")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_data())
