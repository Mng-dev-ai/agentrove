import uuid as uuid_module
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from cryptography.fernet import InvalidToken
from sqlalchemy import CHAR, DateTime, String
from sqlalchemy.engine.interfaces import Dialect
from sqlalchemy.types import TypeDecorator


def enum_values(enum_class: type[Enum]) -> list[str]:
    return [entry.value for entry in enum_class]


class UTCDateTime(TypeDecorator[datetime]):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(
        self, value: datetime | None, _dialect: Dialect
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(
        self, value: datetime | None, _dialect: Dialect
    ) -> datetime | None:
        # SQLite returns naive datetimes; treat as UTC so clients get an offset.
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class GUID(TypeDecorator[uuid_module.UUID]):
    impl = CHAR(32)
    cache_ok = True

    def process_bind_param(self, value: Any, _dialect: Dialect) -> str | None:
        if value is None:
            return value
        if isinstance(value, uuid_module.UUID):
            return value.hex
        return uuid_module.UUID(value).hex

    def process_result_value(
        self, value: Any, _dialect: Dialect
    ) -> uuid_module.UUID | None:
        if value is None:
            return value
        if not isinstance(value, uuid_module.UUID):
            return uuid_module.UUID(str(value))
        return value


class EncryptedString(TypeDecorator[str]):
    impl = String
    cache_ok = True

    def process_bind_param(self, value: str | None, _dialect: Dialect) -> str | None:
        from app.core.security import encrypt_value

        if value is None:
            return None
        return encrypt_value(value)

    def process_result_value(self, value: str | None, _dialect: Dialect) -> str | None:
        from app.core.security import decrypt_value

        if value is None:
            return None
        try:
            return decrypt_value(value)
        except InvalidToken:
            return value
