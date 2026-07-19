import json
from uuid import UUID


def parse_stream_cursors(value: str | None) -> dict[UUID, int]:
    # Query JSON: chat id -> last seen seq for multiplexed SSE backlog replay.
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("cursors must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("cursors must be a JSON object")

    cursors: dict[UUID, int] = {}
    for key, raw_seq in parsed.items():
        if not isinstance(raw_seq, int) or isinstance(raw_seq, bool) or raw_seq < 0:
            raise ValueError("cursor seq must be a non-negative integer")
        cursors[UUID(str(key))] = raw_seq
    return cursors


def parse_pty_dimension(
    value: object,
    *,
    default: int,
    min_value: int,
    max_value: int,
) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        return default
    return max(min_value, min(value, max_value))
