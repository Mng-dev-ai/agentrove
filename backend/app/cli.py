import argparse
import asyncio
import sys

from app.core.config import Settings, get_settings
from app.core.user_manager import UserDatabase
from app.db.session import SessionLocal
from app.models.db_models import (  # noqa: F401
    automation,
    channel,
    chat,
    refresh_token,
    workspace,
)
from app.models.db_models.user import User
from app.services.pairing import PairingService


async def pair(email: str) -> None:
    async with SessionLocal() as db:
        user = await UserDatabase(db, User).get_by_email(email)
        if user is None:
            sys.exit(f"No user with email {email}")
        if not user.is_active:
            sys.exit(f"User {email} is inactive")
        secret, expires_at = await PairingService.create_secret(user.id, db)

    print(f"Pairing secret: {secret}")
    print(f"Expires at: {expires_at.isoformat()}")
    base_url = get_settings().BASE_URL
    if base_url != Settings.model_fields["BASE_URL"].default:
        print(f"Pairing link: {base_url.rstrip('/')}/#pair={secret}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    pair_parser = commands.add_parser(
        "pair", help="Create a one-time link to pair a device with this server"
    )
    pair_parser.add_argument("--email", required=True)
    args = parser.parse_args()
    asyncio.run(pair(args.email))


if __name__ == "__main__":
    main()
