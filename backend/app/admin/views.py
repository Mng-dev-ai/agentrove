from enum import Enum
from typing import Any, TypeVar
from urllib.parse import urlencode, urlsplit

from sqladmin import ModelView
from sqladmin.helpers import get_object_identifier
from app.models.db_models.chat import Chat, Message, MessageAttachment
from app.models.db_models.user import User, UserSettings
from wtforms import Form, PasswordField, SelectField
from app.models.db_models.enums import (
    MessageRole,
    MessageStreamStatus,
    AttachmentType,
)
from markupsafe import Markup
from app.core.security import get_password_hash
from starlette.requests import Request


E = TypeVar("E", bound=Enum)


def _format_datetime(model: Any, attr: str) -> str:
    value = getattr(model, attr, None)
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else ""


class EnumCoercer:
    def __init__(self, enum_class: type[E]) -> None:
        self._enum_class = enum_class

    def __call__(self, value: Any) -> str:
        if isinstance(value, self._enum_class):
            return str(value.value)
        return str(value)


class UserAdmin(ModelView, model=User):
    column_list = [
        "id",
        "email",
        "is_superuser",
        "created_at",
        "updated_at",
    ]
    column_searchable_list = ["email"]
    column_sortable_list = [
        "id",
        "email",
        "is_superuser",
        "created_at",
        "updated_at",
    ]
    column_default_sort = [("email", False)]

    column_formatters = {
        "created_at": _format_datetime,
        "updated_at": _format_datetime,
    }

    form_excluded_columns = ["chats", "settings", "hashed_password"]

    async def scaffold_form(self, rules: list[str] | None = None) -> type[Form]:
        # This sqladmin version has no form_extra_fields support, so graft the
        # password field onto the scaffolded form — without it, creating a user
        # fails on the NOT NULL hashed_password column.
        form: type[Form] = await super().scaffold_form(rules)
        form.password = PasswordField("Password")
        return form

    def _url_for_delete(self, request: Request, obj: Any) -> str:
        # SQLAdmin renders absolute delete URLs; proxied admin pages need
        # same-origin AJAX so browser requests keep flowing through /admin.
        query_params = urlencode({"pks": get_object_identifier(obj)})
        url = urlsplit(str(request.url_for("admin:delete", identity=self.identity)))
        return f"{url.path}?{query_params}"

    async def on_model_change(
        self, data: dict[str, Any], model: User, is_created: bool, request: Request
    ) -> None:
        if "password" in data and data["password"]:
            data["hashed_password"] = get_password_hash(data["password"])
            del data["password"]
        await super().on_model_change(data, model, is_created, request)

    name = "User"
    name_plural = "Users"
    icon = "fa-solid fa-user"


class ChatAdmin(ModelView, model=Chat):
    column_list = [
        "id",
        "title",
        "user_id",
        "context_token_usage",
        "created_at",
        "updated_at",
        "sandbox_id",
        "deleted_at",
    ]
    column_searchable_list = ["title"]
    column_sortable_list = [
        "created_at",
        "updated_at",
        "title",
        "context_token_usage",
        "deleted_at",
    ]
    column_default_sort = [("created_at", True)]

    column_formatters = {
        "created_at": _format_datetime,
        "updated_at": _format_datetime,
        "deleted_at": _format_datetime,
        "context_token_usage": lambda m, _: (
            f"{m.context_token_usage:,} tokens"
            if m.context_token_usage is not None
            else ""
        ),
    }

    column_details_list = [
        "id",
        "title",
        "user_id",
        "context_token_usage",
        "created_at",
        "updated_at",
        "sandbox_id",
        "session_id",
        "deleted_at",
        "messages",
    ]

    column_formatters_detail = {
        "user_id": lambda m, _: (
            Markup(f'<a href="/admin/user/details/{m.user_id}">{m.user_id}</a>')
            if m.user_id
            else ""
        )
    }

    inline_models = [
        (
            Message,
            {
                "fields": [
                    "role",
                    "content_text",
                    "model_id",
                    "total_cost_usd",
                    "stream_status",
                    "created_at",
                ],
                "form_columns": ["role", "content_text", "model_id"],
                "column_labels": {
                    "role": "Role",
                    "content_text": "Message",
                    "model_id": "Model",
                    "total_cost_usd": "Cost (USD)",
                    "stream_status": "Status",
                    "created_at": "Sent At",
                },
            },
        )
    ]

    name = "Chat"
    name_plural = "Chats"
    icon = "fa-solid fa-comments"


class MessageAdmin(ModelView, model=Message):
    column_list = [
        "id",
        "chat_id",
        "role",
        "content_text",
        "total_cost_usd",
        "stream_status",
        "created_at",
        "updated_at",
        "model_id",
    ]

    column_formatters = {
        "content_text": lambda m, _: (
            m.content_text[:100] + "..."
            if len(m.content_text) > 100
            else m.content_text
        ),
        "total_cost_usd": lambda m, _: (
            f"${m.total_cost_usd:.4f}" if m.total_cost_usd is not None else "$0.0000"
        ),
        "stream_status": lambda m, _: m.stream_status.value if m.stream_status else "",
        "created_at": _format_datetime,
        "updated_at": _format_datetime,
    }

    column_searchable_list = ["content_text"]
    column_sortable_list = [
        "created_at",
        "updated_at",
        "total_cost_usd",
        "stream_status",
    ]
    column_default_sort = [("created_at", True)]

    column_labels = {
        "total_cost_usd": "Cost (USD)",
        "stream_status": "Stream Status",
    }

    form_overrides = {
        "role": SelectField,
        "stream_status": SelectField,
    }

    form_args = {
        "role": {
            "choices": [(r.value, r.value) for r in MessageRole],
            "coerce": EnumCoercer(MessageRole),
        },
        "stream_status": {
            "choices": [(s.value, s.value) for s in MessageStreamStatus],
            "coerce": EnumCoercer(MessageStreamStatus),
        },
    }

    can_export = True
    column_export_list = [
        "id",
        "chat_id",
        "role",
        "content_text",
        "total_cost_usd",
        "stream_status",
        "created_at",
        "updated_at",
        "model_id",
    ]

    name = "Message"
    name_plural = "Messages"
    icon = "fa-solid fa-message"


class MessageAttachmentAdmin(ModelView, model=MessageAttachment):
    column_list = [
        "id",
        "message_id",
        "filename",
        "file_type",
        "created_at",
        "updated_at",
    ]

    column_formatters = {
        "created_at": _format_datetime,
        "updated_at": _format_datetime,
    }

    column_searchable_list = ["filename"]
    column_sortable_list = [
        "created_at",
        "updated_at",
        "filename",
    ]
    column_default_sort = [("created_at", True)]

    form_overrides = {
        "file_type": SelectField,
    }

    form_args = {
        "file_type": {
            "choices": [(t.value, t.value) for t in AttachmentType],
            "coerce": EnumCoercer(AttachmentType),
        },
    }

    name = "Message Attachment"
    name_plural = "Message Attachments"
    icon = "fa-solid fa-paperclip"


class UserSettingsAdmin(ModelView, model=UserSettings):
    column_list = [
        "id",
        "user_id",
        "created_at",
        "updated_at",
    ]

    column_formatters = {
        "created_at": _format_datetime,
        "updated_at": _format_datetime,
    }

    form_args = {
        "github_personal_access_token": {"label": "GitHub Token"},
    }

    name = "User Settings"
    name_plural = "User Settings"
    icon = "fa-solid fa-gear"
