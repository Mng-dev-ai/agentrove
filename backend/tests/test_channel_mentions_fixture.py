import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models.db_models.channel import Channel, ChannelMember
from app.models.schemas.channel import BROADCAST_MENTIONS, ChannelMemberFields
from app.services.channels.messages import ChannelMessageStore
from server import BROADCAST_MENTIONS as MCP_BROADCAST_MENTIONS
from server import ChannelMember as McpChannelMember

# The frontend's Vitest holds memberDraft.ts and rehypeMentionPills to the same file.
CHANNEL_MENTIONS = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "test"
        / "channelMentions.json"
    ).read_text()
)
NAMES = CHANNEL_MENTIONS["names"]
CHANNEL = Channel(
    all_members=[
        ChannelMember(id=uuid4(), display_name=name)
        for name in CHANNEL_MENTIONS["members"]
    ]
)
MEMBER_IDS = {member.display_name: str(member.id) for member in CHANNEL.members}


def test_fixture_broadcast_words_are_the_reserved_names() -> None:
    assert set(CHANNEL_MENTIONS["broadcastWords"]) == BROADCAST_MENTIONS
    assert MCP_BROADCAST_MENTIONS == BROADCAST_MENTIONS


@pytest.mark.parametrize("name", NAMES["valid"])
def test_fixture_valid_names_are_accepted_trimmed(name: str) -> None:
    assert ChannelMemberFields(display_name=name).display_name == name.strip()
    member = McpChannelMember(model_id="sonnet", display_name=name)
    assert member.display_name == name.strip()


@pytest.mark.parametrize("name", NAMES["invalid"])
def test_fixture_invalid_names_are_rejected(name: str) -> None:
    with pytest.raises(ValidationError):
        ChannelMemberFields(display_name=name)
    with pytest.raises(ValidationError):
        McpChannelMember(model_id="sonnet", display_name=name)


@pytest.mark.parametrize(
    "case", CHANNEL_MENTIONS["mentions"], ids=lambda case: case["text"]
)
def test_fixture_mentions_address_the_expected_members(case: dict[str, Any]) -> None:
    addressed = case["addressed"]
    assert ChannelMessageStore.mentions(CHANNEL, case["text"]) == (
        None if addressed is None else sorted(MEMBER_IDS[name] for name in addressed)
    )
