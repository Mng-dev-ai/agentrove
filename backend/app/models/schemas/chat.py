from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import UploadFile
from pydantic import BaseModel, ConfigDict, Field

from app.models.db_models.enums import AttachmentType, MessageRole, MessageStreamStatus
from app.models.types import PermissionMode
from app.prompts.system_prompt import DEFAULT_PERSONA_NAME


class MessageAttachmentBase(BaseModel):
    file_url: str
    file_type: AttachmentType
    filename: str | None = None


class MessageAttachment(MessageAttachmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    message_id: UUID
    created_at: datetime


class ChatRequest(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    prompt: str = Field(..., min_length=1, max_length=100000)
    chat_id: UUID
    model_id: str = Field(..., min_length=1, max_length=255)
    attached_files: list[UploadFile] | None = None
    permission_mode: PermissionMode = "bypassPermissions"
    thinking_mode: str | None = Field(None, max_length=50)
    worktree: bool = False
    # Codex-only: 1.5x speed service tier via codex-acp's fast-mode config.
    fast_mode: bool = False
    selected_persona_name: str = Field(DEFAULT_PERSONA_NAME, max_length=100)


class MessageBase(BaseModel):
    content_text: str = ""
    content_render: dict[str, Any] = Field(default_factory=lambda: {"events": []})
    last_seq: int = 0
    active_stream_id: UUID | None = None
    role: MessageRole


class Message(MessageBase):
    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)

    id: UUID
    chat_id: UUID
    created_at: datetime
    model_id: str | None = None
    stream_status: MessageStreamStatus | None = None
    duration_ms: int | None = None
    attachments: list[MessageAttachment] = Field(default_factory=list)
    checkpoint_id: UUID | None = None


class ChatBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)


class ChatCreate(ChatBase):
    model_id: str = Field(..., min_length=1, max_length=255)
    workspace_id: UUID
    parent_chat_id: UUID | None = None


class ChatUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    pinned: bool | None = None


class Chat(ChatBase):
    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)

    id: UUID
    user_id: UUID
    workspace_id: UUID
    sandbox_id: str
    created_at: datetime
    updated_at: datetime
    context_token_usage: int | None = None
    pinned_at: datetime | None = None
    worktree_cwd: str | None = None
    parent_chat_id: UUID | None = None
    sub_thread_count: int = 0
    session_agent_kind: str | None = None
    unread: bool = False
    last_model_id: str | None = None
    last_thinking_mode: str | None = None
    last_persona_name: str | None = None


class ContextUsage(BaseModel):
    tokens_used: int
    context_window: int
    percentage: float


class ChatCompletionResponse(BaseModel):
    chat_id: UUID
    message_id: UUID
    last_seq: int = 0
    checkpoint_id: UUID | None = None
    # Set when this turn bound a worktree — client can update UI without waiting.
    worktree_cwd: str | None = None


class EnhancePromptResponse(BaseModel):
    enhanced_prompt: str


class AskCodeRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=10000)
    code: str = Field(..., min_length=1, max_length=100000)
    # Editor selections only — chat-page text selections omit file identity.
    file_path: str | None = Field(None, min_length=1, max_length=1024)
    language: str | None = Field(None, min_length=1, max_length=64)
    start_line: int | None = Field(None, ge=1)
    end_line: int | None = Field(None, ge=1)
    model_id: str = Field(..., min_length=1, max_length=255)


class AskCodeResponse(BaseModel):
    answer: str


class GenerateTitleResponse(BaseModel):
    title: str


class ChatStatusResponse(BaseModel):
    has_active_task: bool
    message_id: UUID | None = None
    stream_id: UUID | None = None
    last_seq: int = 0


class ActiveStreamStatus(BaseModel):
    chat_id: UUID
    message_id: UUID
    stream_id: UUID | None = None
    last_seq: int = 0


class MessageEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    message_id: UUID
    chat_id: UUID
    stream_id: UUID
    seq: int
    event_type: str
    render_payload: dict[str, Any]
    audit_payload: dict[str, Any] | None = None
    created_at: datetime


class PermissionRespondResponse(BaseModel):
    success: bool


class ChatSearchMatch(BaseModel):
    message_id: UUID
    role: MessageRole
    # Pre-split: Python codepoints vs JS UTF-16 disagree on non-BMP offsets.
    snippet_before: str
    snippet_match: str
    snippet_after: str
    created_at: datetime


class ChatSearchResult(BaseModel):
    chat_id: UUID
    chat_title: str
    workspace_id: UUID
    workspace_name: str
    matches: list[ChatSearchMatch]
    match_count: int


class ChatSearchResponse(BaseModel):
    results: list[ChatSearchResult]
    truncated: bool
