import enum


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"


class AttachmentType(str, enum.Enum):
    IMAGE = "image"
    PDF = "pdf"
    XLSX = "xlsx"


class MessageStreamStatus(str, enum.Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


class ToolStatus(str, enum.Enum):
    STARTED = "started"
    COMPLETED = "completed"
    FAILED = "failed"


class StreamEventKind(str, enum.Enum):
    STREAM = "stream"
