import logging
from datetime import datetime, timezone
from typing import Any, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from croniter import CroniterError, croniter
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import MODELS
from app.models.db_models.automation import Automation
from app.models.db_models.channel import Channel
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.automation import (
    AutomationCreate,
    AutomationRunResponse,
    AutomationUpdate,
)
from app.models.schemas.chat import ChatCreate, ChatRequest
from app.models.schemas.queue import QUEUE_CONTENT_MAX_LENGTH, AutomationQueuedMessage
from app.models.types import PermissionMode
from app.services.agent import AgentService
from app.services.channel import channel_service
from app.services.chat import ChatService
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import AutomationException, ErrorCode, ServiceException
from app.services.pairing import PairingService
from app.services.queue import ChannelQueueService
from app.utils.cache import cache_connection

logger = logging.getLogger(__name__)

# Changing these invalidates the cached next_run_at.
SCHEDULE_FIELDS = frozenset({"cron_expression", "timezone", "enabled"})


class AutomationService(BaseDbService[Automation]):
    def __init__(
        self,
        chat_service: ChatService,
        session_factory: SessionFactoryType | None = None,
    ) -> None:
        super().__init__(session_factory)
        self._chat_service = chat_service

    @staticmethod
    def compute_next_run(
        cron_expression: str, timezone_name: str, base: datetime | None = None
    ) -> datetime:
        # Evaluate the cron in the automation's own zone so "daily at 9am"
        # follows the user's wall clock (incl. DST), then store UTC for the
        # dispatch comparison.
        tz = ZoneInfo(timezone_name)
        base = datetime.now(tz) if base is None else base.astimezone(tz)
        it = croniter(cron_expression, base)
        next_local: datetime = it.get_next(datetime)
        # DST fall-back: during the repeated hour croniter can return a wall-clock
        # time that already elapsed before `base` (naive local time moves backward
        # while the UTC instant moves forward). Fire each wall-clock slot at most
        # once: skip candidates whose naive local time is not after base's.
        # Bounded: candidates advance monotonically in real time, so this scans
        # at most one repeated hour (~82ms worst case for an every-second cron,
        # once a year; 0.2ms for minute-level crons).
        while next_local.replace(tzinfo=None) <= base.replace(tzinfo=None):
            next_local = it.get_next(datetime)
        return next_local.astimezone(timezone.utc)

    def _compute_next_run_validated(
        self, cron_expression: str, timezone_name: str
    ) -> datetime:
        # The schema's croniter.is_valid check is syntax-only and timezone-blind:
        # whether a calendar-constrained or year-bounded expression still has a
        # future slot depends on the automation's own zone (a UTC-based probe
        # mis-judges around year boundaries), so the authoritative check is here.
        try:
            return self.compute_next_run(cron_expression, timezone_name)
        except CroniterError as e:
            raise AutomationException(
                "Cron expression has no future occurrence in its timezone",
                error_code=ErrorCode.VALIDATION_ERROR,
                details={"cron_expression": cron_expression},
                status_code=400,
            ) from e

    @staticmethod
    def _validate_model(model_id: str) -> None:
        if model_id not in MODELS:
            raise AutomationException(
                "Unknown model",
                error_code=ErrorCode.VALIDATION_ERROR,
                details={"model_id": model_id},
                status_code=400,
            )

    @staticmethod
    async def _validate_workspace(
        db: AsyncSession, workspace_id: UUID, user_id: UUID
    ) -> None:
        result = await db.execute(
            select(Workspace.id).filter(
                Workspace.id == workspace_id,
                Workspace.user_id == user_id,
                Workspace.deleted_at.is_(None),
            )
        )
        if not result.one_or_none():
            raise AutomationException(
                "Workspace not found",
                error_code=ErrorCode.WORKSPACE_NOT_FOUND,
                details={"workspace_id": str(workspace_id)},
                status_code=404,
            )

    @staticmethod
    async def _target_channel(
        user: User, channel_id: UUID, workspace_id: UUID
    ) -> Channel:
        try:
            channel: Channel | None = await channel_service.get(channel_id, user)
        except HTTPException:
            channel = None
        if channel is None or channel.workspace_id != workspace_id:
            raise AutomationException(
                "Target channel not found in this workspace",
                error_code=ErrorCode.CHANNEL_NOT_FOUND,
                details={"channel_id": str(channel_id)},
                status_code=404,
            )
        return channel

    @staticmethod
    def _channel_post(name: str, prompt: str) -> str:
        return f"[Automation: {name}]\n{prompt}"

    @classmethod
    def _validate_channel_post(cls, name: str, prompt: str) -> None:
        if len(cls._channel_post(name, prompt)) > QUEUE_CONTENT_MAX_LENGTH:
            raise AutomationException(
                "Prompt is too long to post into a channel with the automation name",
                error_code=ErrorCode.VALIDATION_ERROR,
                details={"max_length": str(QUEUE_CONTENT_MAX_LENGTH)},
                status_code=400,
            )

    async def _get_owned(
        self, db: AsyncSession, automation_id: UUID, user: User
    ) -> Automation:
        result = await db.execute(
            select(Automation).filter(
                Automation.id == automation_id,
                Automation.user_id == user.id,
            )
        )
        automation: Automation | None = result.scalar_one_or_none()
        if not automation:
            raise AutomationException(
                "Automation not found",
                details={"automation_id": str(automation_id)},
                status_code=404,
            )
        self.require_agent_workspace(user, automation.workspace_id)
        return automation

    async def list_automations(self, user: User) -> list[Automation]:
        query = select(Automation).filter(Automation.user_id == user.id)
        workspace_id = self.agent_workspace_filter(user, None)
        if workspace_id is not None:
            query = query.filter(Automation.workspace_id == workspace_id)
        async with self.session_factory() as db:
            result = await db.execute(query.order_by(Automation.created_at.desc()))
            return list(result.scalars().all())

    async def create_automation(
        self, user: User, device_ids: frozenset[UUID], data: AutomationCreate
    ) -> Automation:
        self._validate_model(data.model_id)
        self.require_agent_workspace(user, data.workspace_id)
        async with self.session_factory() as db:
            await self._validate_workspace(db, data.workspace_id, user.id)
            if data.channel_id is not None:
                self._validate_channel_post(data.name, data.prompt)
                await self._target_channel(user, data.channel_id, data.workspace_id)
            automation = Automation(
                user_id=user.id,
                device_ids=device_ids,
                **data.model_dump(),
                next_run_at=self._compute_next_run_validated(
                    data.cron_expression, data.timezone
                ),
            )
            db.add(automation)
            await db.commit()
            await db.refresh(automation)
            return automation

    async def update_automation(
        self,
        automation_id: UUID,
        user: User,
        device_ids: frozenset[UUID],
        data: AutomationUpdate,
    ) -> Automation:
        changes = data.model_dump(exclude_unset=True)
        if "model_id" in changes:
            self._validate_model(changes["model_id"])
        async with self.session_factory() as db:
            automation = await self._get_owned(db, automation_id, user)
            if "workspace_id" in changes:
                self.require_agent_workspace(user, changes["workspace_id"])
                await self._validate_workspace(db, changes["workspace_id"], user.id)
            channel_id = changes.get("channel_id", automation.channel_id)
            if channel_id is not None and changes.keys() & {
                "name",
                "prompt",
                "channel_id",
            }:
                self._validate_channel_post(
                    changes.get("name", automation.name),
                    changes.get("prompt", automation.prompt),
                )
            retargeted = changes.keys() & {"channel_id", "workspace_id"}
            if channel_id is not None and retargeted:
                await self._target_channel(
                    user,
                    channel_id,
                    changes.get("workspace_id", automation.workspace_id),
                )
            automation.device_ids = PairingService.edited_device_ids(
                automation.device_ids,
                device_ids,
                changes.get("prompt", automation.prompt) == automation.prompt,
            )
            for field, value in changes.items():
                setattr(automation, field, value)
            if SCHEDULE_FIELDS & changes.keys():
                automation.next_run_at = self._compute_next_run_validated(
                    automation.cron_expression, automation.timezone
                )
            await db.commit()
            await db.refresh(automation)
            return automation

    async def delete_automation(self, automation_id: UUID, user: User) -> None:
        async with self.session_factory() as db:
            automation = await self._get_owned(db, automation_id, user)
            await db.delete(automation)
            await db.commit()

    async def run_automation(
        self, automation_id: UUID, user: User, device_ids: frozenset[UUID]
    ) -> AutomationRunResponse:
        # Manual "run now" — records last_run_at but leaves next_run_at alone so
        # the scheduled slot still fires.
        async with self.session_factory() as db:
            automation = await self._get_owned(db, automation_id, user)
            automation.last_run_at = datetime.now(timezone.utc)
            await db.commit()
        return await self._fire(automation, user, automation.device_ids | device_ids)

    async def run_due_automations(self) -> dict[str, Any]:
        # Dispatch job entry point. Advances schedules before firing so a crash
        # mid-dispatch can't re-fire the same slot on the next poll.
        now = datetime.now(timezone.utc)
        to_fire: list[Automation] = []
        users: dict[UUID, User] = {}
        async with self.session_factory() as db:
            result = await db.execute(
                select(Automation).filter(
                    Automation.enabled.is_(True),
                    Automation.next_run_at <= now,
                )
            )
            due = list(result.scalars().all())
            for automation in due:
                # A row whose schedule can no longer be computed (exhausted
                # year-bounded cron, timezone dropped from tzdata) must not
                # abort the batch: disable it and move on.
                try:
                    next_run = self.compute_next_run(
                        automation.cron_expression, automation.timezone
                    )
                except Exception:
                    logger.exception(
                        "Automation %s (%s) schedule is uncomputable; disabling",
                        automation.id,
                        automation.name,
                    )
                    # Guarded like the claim below: a concurrent repair (PATCH
                    # of a schedule field) recomputes next_run_at, so only the
                    # still-broken row is disabled — never a just-fixed one.
                    await db.execute(
                        update(Automation)
                        .where(
                            Automation.id == automation.id,
                            Automation.next_run_at == automation.next_run_at,
                        )
                        .values(enabled=False)
                        .execution_options(synchronize_session=False)
                    )
                    continue
                try:
                    if automation.user_id not in users:
                        users[automation.user_id] = await db.get_one(
                            User, automation.user_id
                        )
                except Exception:
                    # Likely transient; leave the row due and retry next tick.
                    logger.exception(
                        "Automation %s: could not load user %s; skipping tick",
                        automation.id,
                        automation.user_id,
                    )
                    continue
                # Compare-and-swap claim: only the dispatcher that advances the
                # row fires it, so a concurrent process can't double-fire a slot.
                claim = await db.execute(
                    update(Automation)
                    .where(
                        Automation.id == automation.id,
                        Automation.next_run_at == automation.next_run_at,
                    )
                    .values(next_run_at=next_run, last_run_at=now)
                    .execution_options(synchronize_session=False)
                )
                if claim.rowcount == 1:
                    to_fire.append(automation)
            await db.commit()

        for automation in to_fire:
            if automation.channel_id is None and automation.model_id not in MODELS:
                await self._disable_unrunnable(
                    automation, f"model {automation.model_id} retired"
                )
                continue
            try:
                await self._fire(
                    automation, users[automation.user_id], automation.device_ids
                )
            except ServiceException as exc:
                if exc.error_code == ErrorCode.WORKSPACE_NOT_FOUND:
                    # Soft-deleted workspace: the run can never succeed again.
                    await self._disable_unrunnable(
                        automation, f"workspace {automation.workspace_id} deleted"
                    )
                elif exc.error_code == ErrorCode.CHANNEL_NOT_FOUND:
                    await self._disable_unrunnable(
                        automation, f"target channel {automation.channel_id} missing"
                    )
                logger.exception(
                    "Automation %s (%s) failed to start",
                    automation.id,
                    automation.name,
                )
            except Exception:
                logger.exception(
                    "Automation %s (%s) failed to start", automation.id, automation.name
                )
        return {}

    async def _disable_unrunnable(self, automation: Automation, reason: str) -> None:
        async with self.session_factory() as db:
            await db.execute(
                update(Automation)
                .where(
                    Automation.id == automation.id,
                    # Guard against a concurrent repair: only disable if the
                    # row still points at the workspace, model and channel that failed.
                    Automation.workspace_id == automation.workspace_id,
                    Automation.model_id == automation.model_id,
                    Automation.channel_id == automation.channel_id,
                )
                .values(enabled=False)
            )
            await db.commit()
        logger.warning("Automation %s disabled: %s", automation.id, reason)

    async def _fire(
        self, automation: Automation, user: User, device_ids: frozenset[UUID]
    ) -> AutomationRunResponse:
        # Re-check the saved model before creating the chat — a model retired
        # after creation would otherwise leave an orphan empty chat every slot.
        if automation.channel_id is None:
            self._validate_model(automation.model_id)
        await AgentService(session_factory=self.session_factory).ensure_devices_active(
            user.id, device_ids
        )
        if automation.channel_id is not None:
            return await self._queue_in_channel(
                automation, user, automation.channel_id, device_ids
            )
        # Timestamp in the title keeps recurring runs distinguishable in the
        # sidebar; sliced so a max-length name still fits ChatCreate's 255 cap.
        stamp = datetime.now(ZoneInfo(automation.timezone)).strftime("%b %d, %H:%M")
        chat = await self._chat_service.create_chat(
            user,
            ChatCreate(
                title=(automation.name + " · " + stamp)[:255],
                model_id=automation.model_id,
                workspace_id=automation.workspace_id,
            ),
        )
        try:
            await self._chat_service.initiate_chat_completion(
                ChatRequest(
                    prompt=automation.prompt,
                    chat_id=chat.id,
                    model_id=automation.model_id,
                    permission_mode=cast(PermissionMode, automation.permission_mode),
                    thinking_mode=automation.thinking_mode,
                    worktree=automation.worktree,
                    selected_persona_name=automation.selected_persona_name,
                ),
                user,
                device_ids=device_ids,
            )
        except Exception:
            # Don't leave an empty orphan chat for a run that never started.
            try:
                await self._chat_service.delete_chat(chat.id, user)
            except Exception:
                logger.exception(
                    "Failed to clean up chat %s after initiation failure", chat.id
                )
            raise
        return AutomationRunResponse(chat_id=chat.id)

    @classmethod
    async def _queue_in_channel(
        cls,
        automation: Automation,
        user: User,
        channel_id: UUID,
        device_ids: frozenset[UUID],
    ) -> AutomationRunResponse:
        channel = await cls._target_channel(user, channel_id, automation.workspace_id)
        async with cache_connection() as cache:
            added = await ChannelQueueService(cache).add_automation_message(
                str(channel.id),
                AutomationQueuedMessage(
                    content=cls._channel_post(automation.name, automation.prompt),
                    device_ids=device_ids,
                    automation_id=automation.id,
                ),
            )
        await channel_service.dispatch_queued(channel)
        return AutomationRunResponse(channel_id=channel.id, queued=added is not None)
