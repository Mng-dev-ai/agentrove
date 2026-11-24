import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from app.catalog import MODELS
from app.models.db_models.channel import Channel, ChannelMember, ChannelMessage

ACTIVITY_EPOCH = uuid4().hex


class TurnStatus(Enum):
    RUNNING = "running"
    CANCELLED = "cancelled"
    FAILED = "failed"
    FINISHED = "finished"


@dataclass
class MemberRetry:
    delay: float
    until: float
    reason: str
    attempts: int


@dataclass
class MemberTurn:
    member: ChannelMember
    batch: list[ChannelMessage]
    source_message_id: UUID | None = None
    tool_call_ids: set[str] = field(default_factory=set)
    text: str = ""
    reset_segment: bool = False
    last_flush_at: float = 0
    flush_task: asyncio.Task[None] | None = None
    message: ChannelMessage | None = None
    status: TurnStatus = TurnStatus.RUNNING
    introducing: bool = False
    provider_task: asyncio.Task[str] | None = None
    task: asyncio.Task[None] | None = None

    def started(self, task: asyncio.Task[str]) -> None:
        self.provider_task = task

    @property
    def device_ids(self) -> frozenset[UUID]:
        return frozenset().union(*(message.device_ids for message in self.batch))


@dataclass
class ChannelState:
    channel: Channel
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    control: asyncio.Lock = field(default_factory=asyncio.Lock)
    turns: dict[UUID, MemberTurn] = field(default_factory=dict)
    timer: asyncio.Task[None] | None = None
    retries: dict[UUID, MemberRetry] = field(default_factory=dict)
    gave_up: dict[UUID, str] = field(default_factory=dict)
    permissions: dict[tuple[UUID, str], dict[str, Any]] = field(default_factory=dict)
    elicitations: dict[tuple[UUID, str], dict[str, Any]] = field(default_factory=dict)
    last_reply: tuple[str, ChannelMessage] | None = None
    unavailable: set[UUID] = field(default_factory=set)
    active_member_ids: list[str] = field(default_factory=list)
    waiting_member_ids: list[str] = field(default_factory=list)
    elicitation_requests: list[dict[str, Any]] = field(default_factory=list)
    retrying_member_ids: list[str] = field(default_factory=list)
    member_errors: dict[str, str] = field(default_factory=dict)
    gave_up_members: dict[str, str] = field(default_factory=dict)
    activity_version: int = 0
    quiet_until: float = 0
    paused: bool = False
    deleted: bool = False

    def member_activity(self) -> dict[str, Any]:
        return {
            "epoch": ACTIVITY_EPOCH,
            "version": self.activity_version,
            "member_ids": self.active_member_ids,
            "waiting_member_ids": self.waiting_member_ids,
            "elicitations": self.elicitation_requests,
            "retrying_member_ids": self.retrying_member_ids,
            "member_errors": self.member_errors,
            "unavailable_members": {
                str(member.id): f"Model {member.model_id} is unknown on this instance"
                for member in self.channel.members
                if member.model_id not in MODELS
            }
            | self.gave_up_members,
        }

    def give_fresh_attempts(self, audience: list[str] | None) -> None:
        if audience is None:
            self.retries.clear()
            self.gave_up.clear()
        for member_id in audience or []:
            self.retries.pop(UUID(member_id), None)
            self.gave_up.pop(UUID(member_id), None)

    def idle(self) -> bool:
        return not (
            self.turns
            or self.retries
            or self.permissions
            or self.elicitations
            or self.timer
            or self.paused
            or self.deleted
        )
