import logging
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status, Request
from sqlalchemy.exc import SQLAlchemyError
from sse_starlette.sse import EventSourceResponse

from app.core.deps import (
    get_cancel_stream_action,
    get_chat_context_usage_action,
    get_chat_messages_action,
    get_clear_queue_action,
    get_create_chat_action,
    get_delete_all_chats_action,
    get_delete_chat_action,
    get_enhance_prompt_action,
    get_fork_chat_action,
    get_get_chat_detail_action,
    get_get_chats_action,
    get_get_queue_action,
    get_get_stream_status_action,
    get_message_events_action,
    get_queue_message_action,
    get_respond_permission_action,
    get_restore_chat_action,
    get_send_message_action,
    get_stream_events_action,
    get_update_chat_action,
    get_update_queued_message_action,
)
from app.actions.chat.clear_queue import ClearQueueAction
from app.core.security import get_current_user
from app.actions.chat.cancel_stream import CancelStreamAction
from app.actions.chat.get_chat_context_usage import GetChatContextUsageAction
from app.actions.chat.create_chat import CreateChatAction
from app.actions.chat.delete_all_chats import DeleteAllChatsAction
from app.actions.chat.delete_chat import DeleteChatAction
from app.actions.chat.enhance_prompt import EnhancePromptAction
from app.actions.chat.fork_chat import ForkChatAction
from app.actions.chat.get_chat_detail import GetChatDetailAction
from app.actions.chat.get_chat_messages import GetChatMessagesAction
from app.actions.chat.get_chats import GetChatsAction
from app.actions.chat.get_message_events import GetMessageEventsAction
from app.actions.chat.get_queue import GetQueueAction
from app.actions.chat.get_stream_status import GetStreamStatusAction
from app.actions.chat.respond_permission import RespondPermissionAction
from app.actions.chat.restore_chat import RestoreChatAction
from app.actions.chat.send_message import SendMessageAction
from app.actions.chat.stream_events import StreamEventsAction
from app.actions.chat.update_chat import UpdateChatAction
from app.actions.chat.update_queued_message import UpdateQueuedMessageAction
from app.actions.queue.queue_message import QueueMessageAction
from app.models.db_models import User
from app.models.schemas import (
    Chat as ChatSchema,
    ChatCompletionResponse,
    ChatCreate,
    ChatStatusResponse,
    ChatUpdate,
    ChatRequest,
    ContextUsage,
    CursorPaginatedMessages,
    CursorPaginationParams,
    EnhancePromptResponse,
    ForkChatRequest,
    ForkChatResponse,
    MessageEvent,
    PaginatedChats,
    PaginationParams,
    PermissionRespondResponse,
    QueuedMessage,
    QueueMessageUpdate,
    QueueUpsertResponse,
    RestoreRequest,
)
from app.services.exceptions import (
    ChatException,
    ClaudeAgentException,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post(
    "/chats",
    response_model=ChatSchema,
    status_code=status.HTTP_201_CREATED,
)
async def create_chat(
    chat_data: ChatCreate,
    current_user: User = Depends(get_current_user),
    create_chat_action: CreateChatAction = Depends(get_create_chat_action),
) -> ChatSchema:
    try:
        chat = await create_chat_action.execute(current_user, chat_data)
        return chat
    except ChatException as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except SQLAlchemyError as e:
        logger.error("Database error creating chat: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while creating chat",
        )


@router.post("/chat", response_model=ChatCompletionResponse)
async def send_message(
    prompt: str = Form(...),
    chat_id: str = Form(...),
    model_id: str = Form(...),
    permission_mode: Literal["plan", "ask", "auto"] = Form("auto"),
    thinking_mode: str | None = Form(None),
    selected_prompt_name: str | None = Form(None),
    attached_files: list[UploadFile] = [],
    send_message_action: SendMessageAction = Depends(get_send_message_action),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        result = await send_message_action.execute(
            ChatRequest(
                prompt=prompt,
                chat_id=UUID(chat_id),
                model_id=model_id,
                attached_files=attached_files,
                permission_mode=permission_mode,
                thinking_mode=thinking_mode,
                selected_prompt_name=selected_prompt_name,
            ),
            current_user,
        )

        return {
            "chat_id": result["chat_id"],
            "message_id": result["message_id"],
            "last_seq": result.get("last_seq", 0),
        }
    except ChatException as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/enhance-prompt", response_model=EnhancePromptResponse)
async def enhance_prompt(
    prompt: str = Form(...),
    model_id: str = Form(...),
    enhance_prompt_action: EnhancePromptAction = Depends(get_enhance_prompt_action),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        return {
            "enhanced_prompt": await enhance_prompt_action.execute(
                prompt, model_id, current_user
            )
        }
    except ClaudeAgentException as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/chats", response_model=PaginatedChats)
async def get_chats(
    pagination: PaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    get_chats_action: GetChatsAction = Depends(get_get_chats_action),
) -> PaginatedChats:
    return await get_chats_action.execute(current_user, pagination)


@router.get(
    "/chats/{chat_id}",
    response_model=ChatSchema,
)
async def get_chat_detail(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    get_chat_detail_action: GetChatDetailAction = Depends(get_get_chat_detail_action),
) -> ChatSchema:
    try:
        return await get_chat_detail_action.execute(chat_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/chats/{chat_id}/context-usage", response_model=ContextUsage)
async def get_chat_context_usage(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    get_chat_context_usage_action: GetChatContextUsageAction = Depends(
        get_chat_context_usage_action
    ),
) -> ContextUsage:
    return await get_chat_context_usage_action.execute(chat_id, current_user)


@router.patch("/chats/{chat_id}", response_model=ChatSchema)
async def update_chat(
    chat_id: UUID,
    chat_update: ChatUpdate,
    current_user: User = Depends(get_current_user),
    update_chat_action: UpdateChatAction = Depends(get_update_chat_action),
) -> ChatSchema:
    try:
        return await update_chat_action.execute(chat_id, chat_update, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.delete("/chats/all", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_chats(
    current_user: User = Depends(get_current_user),
    delete_all_chats_action: DeleteAllChatsAction = Depends(
        get_delete_all_chats_action
    ),
) -> None:
    try:
        await delete_all_chats_action.execute(current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.delete("/chats/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    delete_chat_action: DeleteChatAction = Depends(get_delete_chat_action),
) -> None:
    try:
        await delete_chat_action.execute(chat_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/chats/{chat_id}/messages", response_model=CursorPaginatedMessages)
async def get_chat_messages(
    chat_id: UUID,
    pagination: CursorPaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    get_chat_messages_action: GetChatMessagesAction = Depends(get_chat_messages_action),
) -> CursorPaginatedMessages:
    return await get_chat_messages_action.execute(
        chat_id,
        current_user,
        pagination.cursor,
        pagination.limit,
    )


@router.post("/chats/{chat_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_chat(
    chat_id: UUID,
    request: RestoreRequest,
    current_user: User = Depends(get_current_user),
    restore_chat_action: RestoreChatAction = Depends(get_restore_chat_action),
) -> None:
    try:
        await restore_chat_action.execute(chat_id, request.message_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post(
    "/chats/{chat_id}/fork",
    response_model=ForkChatResponse,
    status_code=status.HTTP_201_CREATED,
)
async def fork_chat(
    chat_id: UUID,
    request: ForkChatRequest,
    current_user: User = Depends(get_current_user),
    fork_chat_action: ForkChatAction = Depends(get_fork_chat_action),
) -> ForkChatResponse:
    try:
        new_chat, messages_copied = await fork_chat_action.execute(
            chat_id, request.message_id, current_user
        )
        return ForkChatResponse(chat=new_chat, messages_copied=messages_copied)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/chats/{chat_id}/stream")
async def stream_events(
    chat_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    stream_events_action: StreamEventsAction = Depends(get_stream_events_action),
) -> EventSourceResponse:
    try:
        return await stream_events_action.execute(chat_id, request, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/chats/{chat_id}/status", response_model=ChatStatusResponse)
async def get_stream_status(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    get_stream_status_action: GetStreamStatusAction = Depends(
        get_get_stream_status_action
    ),
) -> dict[str, Any]:
    try:
        return await get_stream_status_action.execute(chat_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/messages/{message_id}/events", response_model=list[MessageEvent])
async def get_message_events(
    message_id: UUID,
    after_seq: int = 0,
    current_user: User = Depends(get_current_user),
    get_message_events_action: GetMessageEventsAction = Depends(
        get_message_events_action
    ),
) -> list[MessageEvent]:
    try:
        return await get_message_events_action.execute(
            message_id, after_seq, current_user
        )
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.delete("/chats/{chat_id}/stream", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_stream(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    cancel_stream_action: CancelStreamAction = Depends(get_cancel_stream_action),
) -> None:
    try:
        await cancel_stream_action.execute(chat_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post(
    "/chats/{chat_id}/permissions/{request_id}/respond",
    response_model=PermissionRespondResponse,
    status_code=status.HTTP_200_OK,
)
async def respond_to_permission(
    chat_id: UUID,
    request_id: str,
    approved: bool = Form(...),
    alternative_instruction: str | None = Form(None),
    user_answers: str | None = Form(None, max_length=50000),
    current_user: User = Depends(get_current_user),
    respond_permission_action: RespondPermissionAction = Depends(
        get_respond_permission_action
    ),
) -> PermissionRespondResponse:
    try:
        return await respond_permission_action.execute(
            chat_id=chat_id,
            request_id=request_id,
            approved=approved,
            alternative_instruction=alternative_instruction,
            user_answers=user_answers,
            current_user=current_user,
        )
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post(
    "/chats/{chat_id}/queue",
    response_model=QueueUpsertResponse,
    status_code=status.HTTP_201_CREATED,
)
async def queue_message(
    chat_id: UUID,
    content: str = Form(...),
    model_id: str = Form(...),
    permission_mode: Literal["plan", "ask", "auto"] = Form("auto"),
    thinking_mode: str | None = Form(None),
    attached_files: list[UploadFile] = [],
    current_user: User = Depends(get_current_user),
    queue_message_action: QueueMessageAction = Depends(get_queue_message_action),
) -> QueueUpsertResponse:
    try:
        return await queue_message_action.execute(
            chat_id=chat_id,
            content=content,
            model_id=model_id,
            permission_mode=permission_mode,
            thinking_mode=thinking_mode,
            attached_files=attached_files,
            current_user=current_user,
        )
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get(
    "/chats/{chat_id}/queue",
    response_model=QueuedMessage | None,
)
async def get_queue(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    get_queue_action: GetQueueAction = Depends(get_get_queue_action),
) -> QueuedMessage | None:
    try:
        return await get_queue_action.execute(chat_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.patch(
    "/chats/{chat_id}/queue",
    response_model=QueuedMessage,
)
async def update_queued_message(
    chat_id: UUID,
    update: QueueMessageUpdate,
    current_user: User = Depends(get_current_user),
    update_queued_message_action: UpdateQueuedMessageAction = Depends(
        get_update_queued_message_action
    ),
) -> QueuedMessage:
    try:
        return await update_queued_message_action.execute(
            chat_id,
            update.content,
            current_user,
        )
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.delete(
    "/chats/{chat_id}/queue",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def clear_queue(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    clear_queue_action: ClearQueueAction = Depends(get_clear_queue_action),
) -> None:
    try:
        await clear_queue_action.execute(chat_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
