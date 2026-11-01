from collections.abc import AsyncIterator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import tests.bootstrap
from app.constants import MODELS
from app.core.deps import get_queue_service
from app.models.db_models.chat import Message, MessageAttachment
from app.models.db_models.enums import AttachmentType, MessageRole, MessageStreamStatus
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.services import storage as storage_module
from app.services.queue import QueueService
from app.services.sandbox_providers.base import SandboxProvider

from tests.conftest import LoginClient, UserFactory
from tests.helpers import (
    EndpointCache,
    FakeProviderFactory,
    FakeSandboxProvider,
    create_authenticated_workspace,
    create_chat_row,
)


pytestmark = pytest.mark.anyio


async def create_attachment_row(
    db_session: AsyncSession,
    user: User,
    workspace: Workspace,
    *,
    file_path: str,
    filename: str = "notes.txt",
) -> MessageAttachment:
    chat = await create_chat_row(db_session, user, workspace)

    message = Message(
        chat_id=chat.id,
        content_text="See attachment",
        content_render={"events": [{"type": "user_text", "text": "See attachment"}]},
        role=MessageRole.USER,
        stream_status=MessageStreamStatus.COMPLETED,
    )
    db_session.add(message)
    await db_session.flush()

    attachment = MessageAttachment(
        message_id=message.id,
        file_url="/api/v1/attachments/pending/preview",
        file_path=file_path,
        file_type=AttachmentType.PDF,
        filename=filename,
    )
    db_session.add(attachment)
    await db_session.commit()
    await db_session.refresh(attachment)
    return attachment


def storage_path(*parts: str) -> Path:
    return tests.bootstrap.TEST_DIR.joinpath("storage", *parts)


async def test_attachment_preview_and_download_serve_owned_file(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    file_path = storage_path("attachments", str(user.id), "notes.txt")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text("attachment body", encoding="utf-8")
    attachment = await create_attachment_row(
        db_session,
        user,
        workspace,
        file_path=str(file_path.relative_to(storage_path())),
    )

    preview_response = await client.get(
        f"/api/v1/attachments/{attachment.id}/preview", headers=headers
    )
    download_response = await client.get(
        f"/api/v1/attachments/{attachment.id}/download", headers=headers
    )

    assert preview_response.status_code == 200
    assert preview_response.text == "attachment body"
    assert preview_response.headers["cache-control"] == "private, max-age=3600"
    assert preview_response.headers["content-disposition"].startswith("inline;")
    assert download_response.status_code == 200
    assert download_response.text == "attachment body"
    assert download_response.headers["content-disposition"].startswith("attachment;")


async def test_attachment_preview_rejects_other_user(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    owner_headers, owner, workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="attachment-owner@example.com",
        username="attachmentowner",
    )
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="attachment-other@example.com",
        username="attachmentother",
    )
    file_path = storage_path("attachments", str(owner.id), "private.txt")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text("private attachment", encoding="utf-8")
    attachment = await create_attachment_row(
        db_session,
        owner,
        workspace,
        file_path=str(file_path.relative_to(storage_path())),
        filename="private.txt",
    )

    owner_response = await client.get(
        f"/api/v1/attachments/{attachment.id}/preview", headers=owner_headers
    )
    other_response = await client.get(
        f"/api/v1/attachments/{attachment.id}/preview", headers=other_headers
    )

    assert owner_response.status_code == 200
    assert other_response.status_code == 403
    assert other_response.json()["detail"] == "Access denied"


async def test_attachment_preview_returns_404_for_missing_file(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    attachment = await create_attachment_row(
        db_session,
        user,
        workspace,
        file_path=f"attachments/{user.id}/missing.txt",
        filename="missing.txt",
    )

    response = await client.get(
        f"/api/v1/attachments/{attachment.id}/preview", headers=headers
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"


async def test_temp_attachment_preview_allows_only_current_user_temp_dir(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    temp_file = storage_path("temp", str(user.id), "draft.txt")
    temp_file.parent.mkdir(parents=True, exist_ok=True)
    temp_file.write_text("draft attachment", encoding="utf-8")
    other_temp_file = storage_path("temp", "other-user", "draft.txt")
    other_temp_file.parent.mkdir(parents=True, exist_ok=True)
    other_temp_file.write_text("other draft", encoding="utf-8")

    preview_response = await client.get(
        "/api/v1/attachments/temp/preview",
        params={"path": str(temp_file.relative_to(storage_path()))},
        headers=headers,
    )
    other_response = await client.get(
        "/api/v1/attachments/temp/preview",
        params={"path": str(other_temp_file.relative_to(storage_path()))},
        headers=headers,
    )
    traversal_response = await client.get(
        "/api/v1/attachments/temp/preview",
        params={"path": f"temp/{user.id}/../other-user/draft.txt"},
        headers=headers,
    )

    assert preview_response.status_code == 200
    assert preview_response.text == "draft attachment"
    assert preview_response.headers["content-disposition"].startswith("inline;")
    assert other_response.status_code == 403
    assert traversal_response.status_code == 403


async def test_temp_attachment_preview_returns_404_for_missing_file(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        "/api/v1/attachments/temp/preview",
        params={"path": f"temp/{user.id}/missing.txt"},
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"


async def test_attachment_download_returns_404_for_unknown_attachment(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, _user, _workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )

    response = await client.get(
        f"/api/v1/attachments/{uuid4()}/download", headers=headers
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Attachment not found"


async def test_attachment_preview_rejects_path_escaping_storage_dir(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    attachment = await create_attachment_row(
        db_session,
        user,
        workspace,
        file_path="../outside-storage.txt",
        filename="outside-storage.txt",
    )

    response = await client.get(
        f"/api/v1/attachments/{attachment.id}/preview", headers=headers
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Access denied"


class QueueServiceOverride:
    def __init__(self) -> None:
        self.cache = EndpointCache()

    async def __call__(self) -> AsyncIterator[QueueService]:
        async with self.cache.connect() as store:
            yield QueueService(store)


CODEX_MODEL_ID = next(
    model_id for model_id, info in MODELS.items() if info.agent_kind.value == "codex"
)


@pytest.fixture
def sandbox_provider(monkeypatch: pytest.MonkeyPatch) -> FakeSandboxProvider:
    provider = FakeSandboxProvider()
    monkeypatch.setattr(
        SandboxProvider, "create_provider", FakeProviderFactory(provider)
    )
    return provider


@pytest.mark.parametrize(
    ("filename", "content", "content_type", "file_type", "copied_to_sandbox"),
    [
        ("doc.pdf", b"%PDF-1.4 fake", "application/pdf", "pdf", True),
        ("pic.png", b"\x89PNG fake", "image/png", "image", False),
    ],
    ids=["pdf-needs-sandbox-copy", "image-read-inline"],
)
async def test_queue_message_upload_stores_previewable_file(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    sandbox_provider: FakeSandboxProvider,
    filename: str,
    content: bytes,
    content_type: str,
    file_type: str,
    copied_to_sandbox: bool,
) -> None:
    app.dependency_overrides[get_queue_service] = QueueServiceOverride()
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Look at this", "model_id": CODEX_MODEL_ID},
        files={"attached_files": (filename, content, content_type)},
        headers=headers,
    )
    queue_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )
    [stored] = queue_response.json()[0]["attachments"]
    preview_response = await client.get(stored["file_url"], headers=headers)

    assert response.status_code == 201
    assert stored["filename"] == filename
    assert stored["file_type"] == file_type
    assert preview_response.status_code == 200
    assert preview_response.content == content
    # Codex reads images inline; anything else must also exist in the sandbox
    # because the agent opens it from the workspace.
    if copied_to_sandbox:
        [(sandbox_id, path, written)] = sandbox_provider.writes
        assert sandbox_id == workspace.sandbox_id
        assert path.endswith(".pdf")
        assert written == content
    else:
        assert sandbox_provider.writes == []


@pytest.mark.parametrize(
    ("filename", "content", "content_type", "detail"),
    [
        (
            "virus.exe",
            b"MZ",
            "application/octet-stream",
            "Invalid file type: application/octet-stream",
        ),
        (
            "huge.png",
            b"0" * 17,
            "image/png",
            "File too large: 17 bytes exceeds 16 bytes",
        ),
    ],
    ids=["invalid-type", "oversized"],
)
async def test_queue_message_upload_rejects_invalid_file_without_queueing(
    app: FastAPI,
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
    sandbox_provider: FakeSandboxProvider,
    filename: str,
    content: bytes,
    content_type: str,
    detail: str,
) -> None:
    monkeypatch.setattr(storage_module.settings, "MAX_UPLOAD_SIZE", 16)
    app.dependency_overrides[get_queue_service] = QueueServiceOverride()
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    chat = await create_chat_row(db_session, user, workspace)

    response = await client.post(
        f"/api/v1/chat/chats/{chat.id}/queue",
        data={"content": "Bad file", "model_id": CODEX_MODEL_ID},
        files={"attached_files": (filename, content, content_type)},
        headers=headers,
    )
    queue_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/queue", headers=headers
    )

    assert response.status_code == 400
    assert response.json()["detail"] == detail
    assert queue_response.json() == []
    assert sandbox_provider.writes == []


async def test_attach_file_to_in_progress_turn(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    sandbox_provider: FakeSandboxProvider,
) -> None:
    headers, user, workspace = await create_authenticated_workspace(
        db_session, create_user, login
    )
    other_headers, _other_user, _other_workspace = await create_authenticated_workspace(
        db_session,
        create_user,
        login,
        email="attach-turn-other@example.com",
        username="attachturnother",
    )
    chat = await create_chat_row(db_session, user, workspace)
    url = f"/api/v1/chat/chats/{chat.id}/attachments"
    upload = {"file": ("shot.png", b"\x89PNG turn", "image/png")}

    idle_response = await client.post(url, files=upload, headers=headers)

    message = Message(
        chat_id=chat.id,
        content_text="",
        content_render={"events": []},
        role=MessageRole.ASSISTANT,
        stream_status=MessageStreamStatus.IN_PROGRESS,
    )
    db_session.add(message)
    await db_session.commit()

    other_response = await client.post(url, files=upload, headers=other_headers)
    response = await client.post(url, files=upload, headers=headers)
    attachment = response.json()
    preview_response = await client.get(attachment["file_url"], headers=headers)
    messages_response = await client.get(
        f"/api/v1/chat/chats/{chat.id}/messages", headers=headers
    )

    assert idle_response.status_code == 409
    assert other_response.status_code == 404
    assert response.status_code == 201
    assert attachment["message_id"] == str(message.id)
    assert attachment["filename"] == "shot.png"
    assert attachment["file_type"] == "image"
    assert preview_response.status_code == 200
    assert preview_response.content == b"\x89PNG turn"
    [message_item] = messages_response.json()["items"]
    assert [a["id"] for a in message_item["attachments"]] == [attachment["id"]]
    assert sandbox_provider.writes == []
