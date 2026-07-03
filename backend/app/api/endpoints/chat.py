import asyncio
import json
import logging
from typing import Any
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy.exc import SQLAlchemyError
from sse_starlette.sse import EventSourceResponse

from app.constants import (
    MODELS,
    REDIS_KEY_CHAT_CONTEXT_USAGE,
)
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME
from app.core.config import get_settings
from app.core.deps import (
    ensure_chat_access,
    get_agent_service,
    get_chat_service,
    get_queue_service,
)
from app.core.security import get_current_user
from app.models.db_models.chat import Chat
from app.models.db_models.user import User
from app.models.types import MessageAttachmentDict, PermissionMode
from app.models.schemas.chat import (
    ActiveStreamStatus,
    AskCodeRequest,
    AskCodeResponse,
    Chat as ChatSchema,
    ChatCompletionResponse,
    ChatCreate,
    ChatSearchResponse,
    ChatStatusResponse,
    ChatUpdate,
    ChatRequest,
    ContextUsage,
    EnhancePromptResponse,
    GenerateTitleResponse,
    Message as MessageSchema,
    MessageEvent,
    PermissionRespondResponse,
)
from app.models.schemas.sandbox import (
    ChangedFilesResponse,
    FileDiffResponse,
    GitCommandResponse,
)
from app.models.schemas.pagination import (
    CursorPaginatedResponse,
    CursorPaginationParams,
    PaginatedResponse,
    PaginationParams,
)
from app.models.schemas.queue import QueueAddResponse, QueuedMessage, QueueMessageUpdate
from app.services.chat import ChatService
from app.services.agent import AgentService
from app.services.exceptions import (
    AgentException,
    ChatException,
    SandboxException,
)
from app.services.queue import QueueService
from app.services.session_registry import session_registry
from app.services.storage import StorageService
from app.services.streaming.runtime import ChatStreamRuntime
from app.utils.cache import CacheError, cache_connection
from app.utils.parsing import parse_non_negative_seq

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

INACTIVE_TASK_RESPONSE = {
    "has_active_task": False,
    "stream_id": None,
    "last_seq": 0,
}


@router.post(
    "/chats",
    response_model=ChatSchema,
    status_code=status.HTTP_201_CREATED,
)
async def create_chat(
    chat_data: ChatCreate,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSchema:
    try:
        return await chat_service.create_chat(current_user, chat_data)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except SQLAlchemyError as e:
        logger.error("Database error creating chat: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while creating chat",
        ) from e
    except CacheError as e:
        logger.error("Redis error creating chat: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable",
        ) from e


@router.post("/chat", response_model=ChatCompletionResponse)
async def send_message(
    prompt: str = Form(...),
    chat_id: str = Form(...),
    model_id: str = Form(...),
    permission_mode: PermissionMode = Form("bypassPermissions"),
    thinking_mode: str | None = Form(None),
    worktree: bool = Form(False),
    plan_mode: bool = Form(False),
    selected_persona_name: str = Form(DEFAULT_PERSONA_NAME),
    attached_files: list[UploadFile] | None = File(None),
    chat_service: ChatService = Depends(get_chat_service),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    files = attached_files or []
    try:
        result = await chat_service.initiate_chat_completion(
            ChatRequest(
                prompt=prompt,
                chat_id=UUID(chat_id),
                model_id=model_id,
                attached_files=files,
                permission_mode=permission_mode,
                thinking_mode=thinking_mode,
                worktree=worktree,
                plan_mode=plan_mode,
                selected_persona_name=selected_persona_name,
            ),
            current_user,
        )

        return {
            "chat_id": result["chat_id"],
            "message_id": result["message_id"],
            "last_seq": result["last_seq"],
            "checkpoint_id": result["checkpoint_id"],
        }
    except ChatException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        ) from e


@router.post("/enhance-prompt", response_model=EnhancePromptResponse)
async def enhance_prompt(
    prompt: str = Form(...),
    model_id: str = Form(...),
    ai_service: AgentService = Depends(get_agent_service),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        enhanced_prompt = await ai_service.enhance_prompt(
            prompt, model_id, current_user
        )
    except AgentException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    return {"enhanced_prompt": enhanced_prompt}


@router.post("/chats/{chat_id}/generate-title", response_model=GenerateTitleResponse)
async def generate_chat_title(
    chat: Chat = Depends(ensure_chat_access),
    current_user: User = Depends(get_current_user),
    ai_service: AgentService = Depends(get_agent_service),
    chat_service: ChatService = Depends(get_chat_service),
) -> dict[str, str]:
    # Title from the first user message — same source the automatic
    # background titling uses when a chat starts.
    source = await chat_service.get_title_source(chat.id)
    if source is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chat has no messages to generate a title from",
        )
    prompt, model_id = source

    title = await ai_service.generate_title(prompt, model_id, current_user, chat=chat)
    if not title:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Title generation failed",
        )
    return {"title": title[:255]}


@router.post("/chats/{chat_id}/ask-code", response_model=AskCodeResponse)
async def ask_about_code(
    request: AskCodeRequest,
    chat: Chat = Depends(ensure_chat_access),
    current_user: User = Depends(get_current_user),
    ai_service: AgentService = Depends(get_agent_service),
) -> dict[str, str]:
    # Editor inline chat: one-off Q&A about a code selection — no chat turn or
    # message rows; the chat only supplies workspace context and access control.
    try:
        answer = await ai_service.answer_code_question(
            request.question,
            request.code,
            request.file_path,
            request.language,
            request.start_line,
            request.end_line,
            request.model_id,
            current_user,
            chat=chat,
        )
    except AgentException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    return {"answer": answer}


@router.get("/chats", response_model=PaginatedResponse[ChatSchema])
async def get_chats(
    workspace_id: UUID | None = None,
    pinned: bool | None = None,
    pagination: PaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> PaginatedResponse[ChatSchema]:
    return await chat_service.get_user_chats(
        current_user, pagination, workspace_id=workspace_id, pinned=pinned
    )


@router.get("/chats/search", response_model=ChatSearchResponse)
async def search_chats(
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    per_chat_limit: int = Query(5, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSearchResponse:
    # Strip and re-validate so whitespace-only queries (e.g. "  ") don't bypass
    # min_length and reach the DB as an empty %LIKE% that matches everything.
    stripped = q.strip()
    if len(stripped) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Query must contain at least 2 non-whitespace characters",
        )
    try:
        return await chat_service.search_messages(
            current_user, stripped, limit=limit, per_chat_limit=per_chat_limit
        )
    except SQLAlchemyError as e:
        logger.error("Database error searching chats: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while searching chats",
        ) from e


@router.get("/chats/active-streams", response_model=list[ActiveStreamStatus])
async def get_active_streams(
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> list[ActiveStreamStatus]:
    # Bulk variant of /chats/{chat_id}/status: the runtime registry already knows
    # every active chat, so startup restoration needs one call instead of a
    # per-chat (and per-sub-thread) polling fan-out.
    active_ids = ChatStreamRuntime.active_chat_ids()
    if not active_ids:
        return []
    return await chat_service.get_active_streams(
        current_user, [UUID(chat_id) for chat_id in active_ids]
    )


@router.get("/chats/{chat_id}/sub-threads", response_model=list[ChatSchema])
async def get_sub_threads(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> list[ChatSchema]:
    try:
        return await chat_service.get_sub_threads(chat_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except SQLAlchemyError as e:
        logger.error("Database error retrieving sub-threads: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while retrieving sub-threads",
        ) from e


@router.get(
    "/chats/{chat_id}",
    response_model=ChatSchema,
)
async def get_chat_detail(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSchema:
    try:
        chat = await chat_service.get_chat(chat_id, current_user)
        chat.sub_thread_count = await chat_service.count_sub_threads(
            chat_id, current_user
        )
        return chat
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except SQLAlchemyError as e:
        logger.error("Database error retrieving chat: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while retrieving chat",
        ) from e


@router.get("/chats/{chat_id}/context-usage", response_model=ContextUsage)
async def get_chat_context_usage(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ContextUsage:
    chat = await chat_service.get_chat(chat_id, current_user)

    try:
        async with cache_connection() as cache:
            cache_key = REDIS_KEY_CHAT_CONTEXT_USAGE.format(chat_id=str(chat_id))
            cached = await cache.get(cache_key)
            if cached:
                # Cache entries are written by the backend with all fields
                # present. If a payload is partial or malformed, raise so this
                # endpoint falls back to DB data.
                data = json.loads(cached)
                return ContextUsage(
                    tokens_used=int(data["tokens_used"]),
                    context_window=int(data["context_window"]),
                    percentage=float(data["percentage"]),
                )
    except (CacheError, ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
        logger.warning("Failed to get context usage from cache: %s", e)

    tokens_used = chat.context_token_usage
    context_window = await chat_service.get_model_context_window(chat_id) or 0
    percentage = 0.0
    if context_window > 0:
        percentage = min((tokens_used / context_window) * 100, 100.0)

    return ContextUsage(
        tokens_used=tokens_used,
        context_window=context_window,
        percentage=percentage,
    )


@router.patch("/chats/{chat_id}", response_model=ChatSchema)
async def update_chat(
    chat_id: UUID,
    chat_update: ChatUpdate,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSchema:
    try:
        return await chat_service.update_chat(chat_id, chat_update, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except SQLAlchemyError as e:
        logger.error("Database error updating chat: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while updating chat",
        ) from e


@router.delete("/chats/all", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_chats(
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    await chat_service.delete_all_chats(current_user)


@router.delete("/chats/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    await chat_service.delete_chat(chat_id, current_user)


@router.get(
    "/chats/{chat_id}/messages", response_model=CursorPaginatedResponse[MessageSchema]
)
async def get_chat_messages(
    chat_id: UUID,
    pagination: CursorPaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> CursorPaginatedResponse[MessageSchema]:
    return await chat_service.get_chat_messages(
        chat_id, current_user, pagination.cursor, pagination.limit
    )


@router.get("/chats/{chat_id}/stream")
async def stream_events(
    chat_id: UUID,
    request: Request,
    _chat: Chat = Depends(ensure_chat_access),
    chat_service: ChatService = Depends(get_chat_service),
) -> EventSourceResponse:
    # Browser EventSource reconnects send the current cursor via Last-Event-ID.
    # Keep query-param baseline support and use whichever is more advanced.
    after_seq = max(
        parse_non_negative_seq(request.query_params.get("after_seq")),
        parse_non_negative_seq(request.headers.get("Last-Event-ID")),
    )

    return EventSourceResponse(
        chat_service.create_event_stream(chat_id, after_seq),
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/chats/{chat_id}/status", response_model=ChatStatusResponse)
async def get_stream_status(
    chat_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> dict[str, Any]:
    # In-memory gate first: every open chat polls this endpoint on a short
    # interval, but a stream is almost never live. Short-circuit inactive polls
    # before any chat/message DB query so the bursts don't drain the connection
    # pool. Ownership is validated only on the rare active path below.
    if not ChatStreamRuntime.has_active_chat(str(chat_id)):
        return INACTIVE_TASK_RESPONSE.copy()

    try:
        await chat_service.get_chat(chat_id, current_user)
    except ChatException:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found or access denied",
        )

    try:
        active_assistant_message = (
            await chat_service.message_service.get_in_progress_assistant_message(
                chat_id
            )
        )

        if not active_assistant_message:
            return INACTIVE_TASK_RESPONSE.copy()

        return {
            "has_active_task": True,
            "message_id": active_assistant_message.id,
            "stream_id": active_assistant_message.active_stream_id,
            "last_seq": active_assistant_message.last_seq,
        }
    except SQLAlchemyError as e:
        logger.error("Database error checking chat status: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while checking chat status",
        ) from e


@router.get("/messages/{message_id}/events", response_model=list[MessageEvent])
async def get_message_events(
    message_id: UUID,
    after_seq: int = 0,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> list[MessageEvent]:
    message = await chat_service.message_service.get_message(message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    try:
        await chat_service.get_chat(message.chat_id, current_user)
    except ChatException:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found or access denied",
        )
    return await chat_service.message_service.get_message_events_after_seq(
        message_id, after_seq, limit=5000
    )


@router.post(
    "/messages/{message_id}/checkpoint/restore-all",
    response_model=GitCommandResponse,
)
async def restore_message_checkpoint(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> GitCommandResponse:
    try:
        return await chat_service.restore_checkpoint_all(message_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except SandboxException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.get(
    "/messages/{message_id}/changes",
    response_model=ChangedFilesResponse,
)
async def get_message_changes(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> ChangedFilesResponse:
    try:
        return await chat_service.get_changed_files(message_id, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except SandboxException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.get(
    "/messages/{message_id}/changes/diff",
    response_model=FileDiffResponse,
)
async def get_message_file_diff(
    message_id: UUID,
    path: str = Query(..., min_length=1, max_length=4096),
    current_user: User = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
) -> FileDiffResponse:
    try:
        return await chat_service.get_file_diff(message_id, path, current_user)
    except ChatException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except SandboxException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.delete("/chats/{chat_id}/stream", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_stream(
    chat_id: UUID,
    _chat: Chat = Depends(ensure_chat_access),
    chat_service: ChatService = Depends(get_chat_service),
) -> None:
    if not ChatStreamRuntime.has_active_chat(
        str(chat_id)
    ) and not await chat_service.has_cancelable_pending_start(chat_id):
        return

    # Stop can arrive after the assistant row exists but before the runtime task
    # starts; the registry carries that pending cancel into the task.
    await session_registry.cancel_generation(str(chat_id))


@router.post(
    "/chats/{chat_id}/permissions/{request_id}/respond",
    response_model=PermissionRespondResponse,
    status_code=status.HTTP_200_OK,
)
async def respond_to_permission(
    chat_id: UUID,
    request_id: str,
    option_id: str = Form(""),
    _chat: Chat = Depends(ensure_chat_access),
) -> PermissionRespondResponse:
    acp_resolved = session_registry.resolve_permission(
        str(chat_id),
        request_id,
        option_id=option_id,
    )
    if not acp_resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission request not found or expired",
        )

    return PermissionRespondResponse(success=True)


@router.post(
    "/chats/{chat_id}/queue",
    response_model=QueueAddResponse,
    status_code=status.HTTP_201_CREATED,
)
async def queue_message(
    chat_id: UUID,
    content: str = Form(...),
    model_id: str = Form(...),
    permission_mode: PermissionMode = Form("bypassPermissions"),
    thinking_mode: str | None = Form(None),
    worktree: bool = Form(False),
    plan_mode: bool = Form(False),
    selected_persona_name: str = Form(DEFAULT_PERSONA_NAME),
    attached_files: list[UploadFile] | None = File(None),
    chat: Chat = Depends(ensure_chat_access),
    current_user: User = Depends(get_current_user),
    queue_service: QueueService = Depends(get_queue_service),
) -> QueueAddResponse:
    attachments: list[MessageAttachmentDict] | None = None
    files = attached_files or []
    if files:
        ws_sandbox = ChatService.sandbox_for_workspace(chat.workspace)
        file_storage = StorageService(ws_sandbox)
        agent_kind = MODELS[model_id].agent_kind
        attachments = list(
            await asyncio.gather(
                *[
                    file_storage.save_file(
                        file,
                        agent_kind=agent_kind,
                        sandbox_id=chat.workspace.sandbox_id,
                        user_id=str(current_user.id),
                    )
                    for file in files
                ]
            )
        )
    queue_attachments = [dict(item) for item in attachments] if attachments else None

    return await queue_service.add_message(
        str(chat_id),
        content,
        model_id,
        permission_mode=permission_mode,
        thinking_mode=thinking_mode,
        worktree=worktree,
        plan_mode=plan_mode,
        selected_persona_name=selected_persona_name,
        attachments=queue_attachments,
    )


@router.get(
    "/chats/{chat_id}/queue",
    response_model=list[QueuedMessage],
)
async def get_queue(
    chat_id: UUID,
    _chat: Chat = Depends(ensure_chat_access),
    queue_service: QueueService = Depends(get_queue_service),
) -> list[QueuedMessage]:
    return await queue_service.get_queue(str(chat_id))


@router.patch(
    "/chats/{chat_id}/queue/{message_id}",
    response_model=QueuedMessage,
)
async def update_queued_message(
    chat_id: UUID,
    message_id: UUID,
    update: QueueMessageUpdate,
    _chat: Chat = Depends(ensure_chat_access),
    queue_service: QueueService = Depends(get_queue_service),
) -> QueuedMessage:
    result = await queue_service.update_message(
        str(chat_id), str(message_id), update.content
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Queued message not found",
        )
    return result


@router.delete(
    "/chats/{chat_id}/queue/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_queued_message(
    chat_id: UUID,
    message_id: UUID,
    _chat: Chat = Depends(ensure_chat_access),
    queue_service: QueueService = Depends(get_queue_service),
) -> None:
    found = await queue_service.delete_message(str(chat_id), str(message_id))
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Queued message not found",
        )


@router.post(
    "/chats/{chat_id}/queue/{message_id}/send-now",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def send_now_queued_message(
    chat_id: UUID,
    message_id: UUID,
    _chat: Chat = Depends(ensure_chat_access),
    chat_service: ChatService = Depends(get_chat_service),
    queue_service: QueueService = Depends(get_queue_service),
) -> None:
    found = await queue_service.mark_send_now(str(chat_id), str(message_id))
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Queued message not found",
        )

    if ChatStreamRuntime.has_active_chat(str(chat_id)):
        # Cancel the active generation so the runtime picks up the
        # send-now flag immediately instead of waiting for the agent
        # to finish its current turn.
        await session_registry.cancel_generation(str(chat_id))
    else:
        try:
            await ChatStreamRuntime.process_send_now_idle(
                str(chat_id), chat_service.session_factory
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Failed to start idle send-now for chat %s: %s", chat_id, e)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Failed to start send-now execution",
            ) from e


@router.delete(
    "/chats/{chat_id}/queue",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def clear_queue(
    chat_id: UUID,
    _chat: Chat = Depends(ensure_chat_access),
    queue_service: QueueService = Depends(get_queue_service),
) -> None:
    await queue_service.clear_queue(str(chat_id))
