from uuid import UUID

API_PREFIX = "/api/v1"
ATTACHMENTS_PREFIX = f"{API_PREFIX}/attachments"


def build_attachment_preview_url(attachment_id: UUID | str) -> str:
    return f"{ATTACHMENTS_PREFIX}/{attachment_id}/preview"


def build_temp_attachment_preview_url(path: str) -> str:
    return f"{ATTACHMENTS_PREFIX}/temp/preview?path={path}"
