import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from app.catalog import MODELS
from app.models.db_models.channel import Channel, ChannelMember, ChannelMessage
from app.models.schemas.channel import ChannelMemberState, MemberOutcome

ACTIVITY_EPOCH = uuid4().hex
UNKNOWN_MODEL = "Model {model_id} is unknown on this instance"
RoundProgress = Literal["settled", "still running", "interrupted by a user message"]


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
    has_render_ui: bool = False
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


@dataclass(frozen=True)
class MemberReport:
    name: str
    chat_id: str
    state: ChannelMemberState


@dataclass(frozen=True)
class ChannelReport:
    channel_id: str
    name: str
    progress: RoundProgress
    members: list[MemberReport]
    device_ids: frozenset[UUID]


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
    outcomes: dict[UUID, MemberOutcome] = field(default_factory=dict)
    # The current round was started by the parent chat and its report is not built yet.
    report_due: bool = False
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
                str(member.id): UNKNOWN_MODEL.format(model_id=member.model_id)
                for member in self.channel.members
                if member.model_id not in MODELS
            }
            | self.gave_up_members,
        }

    def member_state(self, member: ChannelMember) -> ChannelMemberState:
        blocked_on = [
            f"permission for {pending['request']['tool_name']}"
            for (member_id, _), pending in self.permissions.items()
            if member_id == member.id
        ] + [
            "a question" for member_id, _ in self.elicitations if member_id == member.id
        ]
        turn = self.turns.get(member.id)
        state: ChannelMemberState
        if blocked_on:
            state = ChannelMemberState(state="blocked", detail=", ".join(blocked_on))
        elif member.id in self.gave_up:
            state = ChannelMemberState(state="gave_up", detail=self.gave_up[member.id])
        elif member.model_id not in MODELS:
            state = ChannelMemberState(
                state="unavailable",
                detail=UNKNOWN_MODEL.format(model_id=member.model_id),
            )
        elif turn is not None and turn.status is TurnStatus.RUNNING:
            state = ChannelMemberState(state="running")
        elif member.id in self.retries:
            state = ChannelMemberState(
                state="retrying", detail=self.retries[member.id].reason
            )
        else:
            state = ChannelMemberState(state="idle")
        state.outcome = self.outcomes.get(member.id)
        return state

    def parent_report(self, progress: RoundProgress) -> ChannelReport:
        return ChannelReport(
            channel_id=str(self.channel.id),
            name=self.channel.name,
            progress=progress,
            members=[
                MemberReport(
                    member.display_name, str(member.chat_id), self.member_state(member)
                )
                for member in self.channel.members
            ],
            device_ids=self.channel.owed_report_device_ids or frozenset(),
        )

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
