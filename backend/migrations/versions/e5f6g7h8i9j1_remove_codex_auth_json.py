"""remove codex_auth_json from user_settings

Revision ID: e5f6g7h8i9j1
Revises: de5c3ae2e066
Create Date: 2026-01-21 12:00:00.000000

"""
from typing import Sequence, Union
import json

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6g7h8i9j1'
down_revision: Union[str, None] = 'de5c3ae2e066'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _parse_providers(value: object, decrypt_value) -> list[dict]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            decrypted = decrypt_value(value)
        except Exception:
            decrypted = value
    else:
        decrypted = value

    if isinstance(decrypted, str):
        try:
            parsed = json.loads(decrypted)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            return []
    elif isinstance(decrypted, list):
        return decrypted
    return []


def _get_openai_provider_template(auth_token: str) -> dict:
    return {
        "id": "openai-default",
        "name": "OpenAI",
        "provider_type": "openai",
        "base_url": None,
        "auth_token": auth_token,
        "enabled": True,
        "models": [
            {"model_id": "openai/gpt-5.2-codex", "name": "GPT-5.2 Codex", "enabled": True},
            {"model_id": "openai/gpt-5.2", "name": "GPT-5.2", "enabled": True},
        ],
    }


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    user_settings_columns = [c['name'] for c in inspector.get_columns('user_settings')]

    if 'codex_auth_json' in user_settings_columns and 'custom_providers' in user_settings_columns:
        rows = conn.execute(
            sa.text(
                "SELECT id, codex_auth_json, custom_providers FROM user_settings WHERE codex_auth_json IS NOT NULL"
            )
        ).fetchall()

        if rows:
            from app.core.security import decrypt_value, encrypt_value

            for row in rows:
                codex_auth_json = row.codex_auth_json
                if not codex_auth_json or (
                    isinstance(codex_auth_json, str) and not codex_auth_json.strip()
                ):
                    continue

                if isinstance(codex_auth_json, str):
                    try:
                        codex_auth_json = decrypt_value(codex_auth_json)
                    except Exception:
                        pass

                providers = _parse_providers(row.custom_providers, decrypt_value)
                if not providers:
                    providers = []

                updated = False
                target_provider = None
                for provider in providers:
                    if not isinstance(provider, dict):
                        continue
                    provider_type = provider.get("provider_type")
                    if provider_type in ("openai", "codex"):
                        target_provider = provider
                        break

                if target_provider:
                    existing_token = target_provider.get("auth_token")
                    if not existing_token:
                        target_provider["auth_token"] = codex_auth_json
                        updated = True
                else:
                    providers.append(_get_openai_provider_template(codex_auth_json))
                    updated = True

                if updated:
                    serialized = json.dumps(providers, separators=(",", ":"), ensure_ascii=True)
                    encrypted = encrypt_value(serialized)
                    encrypted_json = json.dumps(encrypted)
                    conn.execute(
                        sa.text(
                            "UPDATE user_settings SET custom_providers = CAST(:value AS JSON) WHERE id = :id"
                        ),
                        {"value": encrypted_json, "id": row.id},
                    )

    if 'codex_auth_json' in user_settings_columns:
        op.drop_column('user_settings', 'codex_auth_json')


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    user_settings_columns = [c['name'] for c in inspector.get_columns('user_settings')]

    if 'codex_auth_json' not in user_settings_columns:
        op.add_column(
            'user_settings',
            sa.Column('codex_auth_json', sa.String(), nullable=True)
        )

    user_settings_columns = [c['name'] for c in inspector.get_columns('user_settings')]
    if 'custom_providers' not in user_settings_columns:
        return

    rows = conn.execute(
        sa.text(
            "SELECT id, custom_providers FROM user_settings WHERE custom_providers IS NOT NULL"
        )
    ).fetchall()

    if not rows:
        return

    from app.core.security import decrypt_value, encrypt_value

    for row in rows:
        providers = _parse_providers(row.custom_providers, decrypt_value)
        if not providers:
            continue

        codex_auth_json = None
        for provider in providers:
            if not isinstance(provider, dict):
                continue
            provider_type = provider.get("provider_type")
            if provider_type in ("openai", "codex"):
                codex_auth_json = provider.get("auth_token")
                if codex_auth_json:
                    break

        if codex_auth_json:
            if not isinstance(codex_auth_json, str):
                codex_auth_json = json.dumps(codex_auth_json, ensure_ascii=True)
            codex_auth_json = encrypt_value(codex_auth_json)
            conn.execute(
                sa.text(
                    "UPDATE user_settings SET codex_auth_json = :codex_auth_json WHERE id = :id"
                ),
                {"codex_auth_json": codex_auth_json, "id": row.id},
            )
