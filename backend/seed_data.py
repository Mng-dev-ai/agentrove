#!/usr/bin/env python3
import asyncio
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.db.session import SessionLocal, engine
from app.models.db_models.user import User, UserSettings


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
    # Reuse the app engine so seeding runs with the same SQLite pragmas
    # (foreign keys, WAL) instead of a bare unconfigured connection.
    async with SessionLocal() as session:
        await seed_admin(session)
        await session.commit()
        print("Seed completed successfully")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_data())
