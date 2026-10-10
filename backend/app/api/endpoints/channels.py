from typing import Any
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
)

from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.channel import (
    ChannelCreate,
    ChannelUpdate,
    ChannelMessageRead,
    ChannelRead,
)
from app.models.schemas.chat import Message as MessageSchema
from app.services.channel import channel_service
from app.services.exceptions import ChatException, StorageException, SandboxException

router = APIRouter()


@router.post("", response_model=ChannelRead, status_code=201)
async def create_channel(
    data: ChannelCreate, user: User = Depends(get_current_user)
) -> ChannelRead:
    try:
        channel = await channel_service.create(user, data)
    except (ChatException, SandboxException) as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    return channel_service.read(channel)


@router.get("", response_model=list[ChannelRead])
async def list_channels(
    workspace_id: UUID | None = None, user: User = Depends(get_current_user)
) -> list[ChannelRead]:
    return [
        channel_service.read(channel)
        for channel in await channel_service.list_channels(user, workspace_id)
    ]


@router.get("/{channel_id}", response_model=ChannelRead)
async def get_channel(
    channel_id: UUID, user: User = Depends(get_current_user)
) -> ChannelRead:
    return channel_service.read(await channel_service.get(channel_id, user))


@router.get("/{channel_id}/messages", response_model=list[ChannelMessageRead])
async def list_messages(
    channel_id: UUID,
    after_seq: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
) -> list[ChannelMessageRead]:
    channel = await channel_service.get(channel_id, user)
    return [
        ChannelMessageRead.model_validate(message)
        for message in await channel_service.messages(channel, after_seq)
    ]


@router.get(
    "/{channel_id}/messages/{message_id}/activity", response_model=MessageSchema
)
async def message_activity(
    channel_id: UUID, message_id: UUID, user: User = Depends(get_current_user)
) -> MessageSchema:
    channel = await channel_service.get(channel_id, user)
    return await channel_service.activity(channel, message_id)


@router.post(
    "/{channel_id}/messages", response_model=ChannelMessageRead, status_code=201
)
async def post_message(
    channel_id: UUID,
    content: str = Form(..., min_length=1, max_length=100000),
    attached_files: list[UploadFile] | None = File(None),
    user: User = Depends(get_current_user),
) -> ChannelMessageRead:
    channel = await channel_service.get(channel_id, user)
    try:
        response: ChannelMessageRead = ChannelMessageRead.model_validate(
            await channel_service.post(channel, content, attached_files)
        )
    except (StorageException, SandboxException) as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    return response


@router.post("/{channel_id}/stop", status_code=204)
async def stop_channel(
    channel_id: UUID, user: User = Depends(get_current_user)
) -> Response:
    await channel_service.stop(await channel_service.get(channel_id, user))
    return Response(status_code=204)


@router.delete("/{channel_id}", status_code=204)
async def delete_channel(
    channel_id: UUID, user: User = Depends(get_current_user)
) -> Response:
    await channel_service.delete(await channel_service.get(channel_id, user))
    return Response(status_code=204)


@router.patch("/{channel_id}", response_model=ChannelRead)
async def rename_channel(
    channel_id: UUID, data: ChannelUpdate, user: User = Depends(get_current_user)
) -> ChannelRead:
    channel = await channel_service.get(channel_id, user)
    return channel_service.read(await channel_service.rename(channel, data.name))


@router.get("/{channel_id}/permissions")
async def pending_permissions(
    channel_id: UUID, user: User = Depends(get_current_user)
) -> list[dict[str, Any]]:
    channel = await channel_service.get(channel_id, user)
    return list(channel_service.state(channel).permissions.values())


@router.get("/{channel_id}/member-activity")
async def member_activity(
    channel_id: UUID, user: User = Depends(get_current_user)
) -> dict[str, Any]:
    channel = await channel_service.get(channel_id, user)
    return channel_service.member_activity(channel_service.state(channel))
