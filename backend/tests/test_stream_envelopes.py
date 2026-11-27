import json
from pathlib import Path
from typing import get_args
from uuid import UUID

from app.services.streaming.types import (
    SNAPSHOT_EVENT_KINDS,
    StreamEnvelope,
    StreamEnvelopeKind,
)

# The frontend's Vitest holds its StreamEnvelope union to the same file.
STREAM_ENVELOPES = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "test"
        / "streamEnvelopes.json"
    ).read_text()
)
ENVELOPE_KINDS = set(get_args(StreamEnvelopeKind))


def test_fixture_envelopes_are_what_the_backend_builds() -> None:
    for envelope in STREAM_ENVELOPES:
        assert envelope["kind"] in ENVELOPE_KINDS
        assert (
            StreamEnvelope.build(
                chat_id=UUID(envelope["chatId"]),
                message_id=UUID(envelope["messageId"]),
                stream_id=UUID(envelope["streamId"]),
                seq=envelope["seq"],
                kind=envelope["kind"],
                payload=envelope["payload"],
            )
            == envelope
        )


def test_fixture_covers_every_envelope_kind_and_every_system_shape() -> None:
    assert {envelope["kind"] for envelope in STREAM_ENVELOPES} == ENVELOPE_KINDS
    system_payloads = [
        envelope["payload"]
        for envelope in STREAM_ENVELOPES
        if envelope["kind"] == "system"
    ]
    assert any("data" in payload for payload in system_payloads)
    assert any("context_usage" in payload for payload in system_payloads)
    assert any("rate_limits" in payload for payload in system_payloads)


def test_snapshot_kinds_are_envelope_kinds() -> None:
    assert SNAPSHOT_EVENT_KINDS <= ENVELOPE_KINDS
