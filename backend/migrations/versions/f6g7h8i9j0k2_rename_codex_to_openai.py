"""rename codex provider to openai

Revision ID: f6g7h8i9j0k2
Revises: e5f6g7h8i9j1
Create Date: 2026-01-22 10:00:00.000000

"""

import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6g7h8i9j0k2"
down_revision: Union[str, None] = "e5f6g7h8i9j1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _update_providers(
    providers: list[dict],
    from_type: str,
    to_type: str,
    from_prefix: str,
    to_prefix: str,
    from_id: str,
    to_id: str,
    to_name: str,
) -> bool:
    updated = False
    for provider in providers:
        if provider.get("provider_type") == from_type:
            provider["provider_type"] = to_type
            updated = True

        if provider.get("id") == from_id:
            provider["id"] = to_id
            provider["name"] = to_name
            updated = True

        if "models" in provider:
            for model in provider["models"]:
                model_id = model.get("model_id", "")
                if model_id.startswith(from_prefix):
                    model["model_id"] = to_prefix + model_id[len(from_prefix) :]
                    updated = True

    return updated


def _add_openrouter_prefix(providers: list[dict]) -> bool:
    updated = False
    for provider in providers:
        if provider.get("provider_type") != "openrouter":
            continue

        if "models" not in provider:
            continue

        for model in provider["models"]:
            model_id = model.get("model_id", "")
            if model_id and not model_id.startswith("openrouter/"):
                model["model_id"] = f"openrouter/{model_id}"
                updated = True

    return updated


def _clean_openai_model_suffixes(providers: list[dict]) -> bool:
    updated = False
    suffixes_to_remove = [":low", ":medium", ":high", ":xhigh"]
    models_to_remove = ["openai/o3"]

    for provider in providers:
        if provider.get("provider_type") != "openai":
            continue

        if "models" not in provider:
            continue

        seen_model_ids: set[str] = set()
        cleaned_models: list[dict] = []

        for model in provider["models"]:
            model_id = model.get("model_id", "")

            if model_id in models_to_remove:
                updated = True
                continue

            clean_id = model_id
            for suffix in suffixes_to_remove:
                if clean_id.endswith(suffix):
                    clean_id = clean_id[: -len(suffix)]
                    updated = True
                    break

            if clean_id in seen_model_ids:
                updated = True
                continue

            seen_model_ids.add(clean_id)
            model["model_id"] = clean_id

            if "(" in model.get("name", ""):
                base_name = model["name"].split(" (")[0]
                model["name"] = base_name
                updated = True

            cleaned_models.append(model)

        provider["models"] = cleaned_models

    return updated


def upgrade() -> None:
    conn = op.get_bind()

    rows = conn.execute(
        sa.text(
            "SELECT id, custom_providers FROM user_settings WHERE custom_providers IS NOT NULL"
        )
    ).fetchall()

    if not rows:
        return

    from app.core.security import decrypt_value, encrypt_value

    for row in rows:
        value = row.custom_providers
        if value is None:
            continue

        if isinstance(value, str):
            try:
                decrypted = decrypt_value(value)
            except Exception:
                decrypted = value
        else:
            decrypted = value

        providers: list[dict] = []
        if isinstance(decrypted, str):
            try:
                parsed = json.loads(decrypted)
                if isinstance(parsed, list):
                    providers = parsed
            except json.JSONDecodeError:
                continue
        elif isinstance(decrypted, list):
            providers = decrypted
        else:
            continue

        updated = _update_providers(
            providers,
            from_type="codex",
            to_type="openai",
            from_prefix="codex/",
            to_prefix="openai/",
            from_id="codex-default",
            to_id="openai-default",
            to_name="OpenAI",
        )

        suffix_cleaned = _clean_openai_model_suffixes(providers)
        openrouter_prefixed = _add_openrouter_prefix(providers)
        updated = updated or suffix_cleaned or openrouter_prefixed

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


def downgrade() -> None:
    conn = op.get_bind()

    rows = conn.execute(
        sa.text(
            "SELECT id, custom_providers FROM user_settings WHERE custom_providers IS NOT NULL"
        )
    ).fetchall()

    if not rows:
        return

    from app.core.security import decrypt_value, encrypt_value

    for row in rows:
        value = row.custom_providers
        if value is None:
            continue

        if isinstance(value, str):
            try:
                decrypted = decrypt_value(value)
            except Exception:
                decrypted = value
        else:
            decrypted = value

        providers: list[dict] = []
        if isinstance(decrypted, str):
            try:
                parsed = json.loads(decrypted)
                if isinstance(parsed, list):
                    providers = parsed
            except json.JSONDecodeError:
                continue
        elif isinstance(decrypted, list):
            providers = decrypted
        else:
            continue

        updated = _update_providers(
            providers,
            from_type="openai",
            to_type="codex",
            from_prefix="openai/",
            to_prefix="codex/",
            from_id="openai-default",
            to_id="codex-default",
            to_name="Codex CLI",
        )

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
