import base64

from app.services.streaming.types import ToolImage

# Kept small: the snapshot holding it is rewritten every ~2 s during a turn and
# events fan out to every connected device of the user.
MAX_TOOL_IMAGE_BYTES = 2 * 1024 * 1024
TOOL_IMAGE_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


def tool_image(data: bytes) -> ToolImage | None:
    if len(data) > MAX_TOOL_IMAGE_BYTES:
        return None
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mime_type: str | None = "image/webp"
    else:
        mime_type = next(
            (mime for sig, mime in TOOL_IMAGE_SIGNATURES if data.startswith(sig)),
            None,
        )
    if mime_type is None:
        return None
    return ToolImage(mime_type=mime_type, data=base64.b64encode(data).decode("ascii"))
