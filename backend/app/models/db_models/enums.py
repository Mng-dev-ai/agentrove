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


class SubThreadReportStatus(str, enum.Enum):
    RUNNING = "running"
    PENDING = "pending"
    WAKING = "waking"
    COVERED = "covered"
    ACKNOWLEDGED = "acknowledged"
    # Delivered by an app-generated parent message instead of a model turn.
    NOTIFIED = "notified"


class ToolStatus(str, enum.Enum):
    STARTED = "started"
    COMPLETED = "completed"
    FAILED = "failed"


class StreamEventKind(str, enum.Enum):
    STREAM = "stream"
    QUEUE_PROCESSING = "queue_processing"
