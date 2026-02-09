from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, cast
from uuid import UUID

from app.db.session import get_celery_session
from app.models.db_models import (
    Chat,
    Message,
    MessageRole,
    MessageStreamStatus,
    ScheduledTask,
    TaskExecution,
    TaskExecutionStatus,
    TaskStatus,
    User,
    UserSettings,
    RecurrenceType,
)
from app.prompts.system_prompt import build_system_prompt_for_chat
from app.services.exceptions import SchedulerException
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import SandboxProviderType, create_sandbox_provider
from app.services.streaming.orchestrator import StreamOrchestrator
from app.services.user import UserService
from app.utils.validators import APIKeyValidationError, validate_model_api_keys

logger = logging.getLogger(__name__)


class RunScheduledTaskAction:
    def _mark_execution(
        self,
        execution: TaskExecution,
        status: TaskExecutionStatus,
        error_message: str | None = None,
    ) -> None:
        execution.status = status
        execution.completed_at = datetime.now(timezone.utc)
        if error_message:
            execution.error_message = error_message

    def _finalize_task(self, task: ScheduledTask, success: bool) -> None:
        if task.recurrence_type == RecurrenceType.ONCE:
            task.next_execution = None
            task.status = TaskStatus.COMPLETED if success else TaskStatus.FAILED
        else:
            task.status = TaskStatus.ACTIVE

    def _create_sandbox(
        self, user_settings: UserSettings, session_factory: Any
    ) -> SandboxService:
        api_key = None
        if user_settings.sandbox_provider == SandboxProviderType.E2B.value:
            api_key = user_settings.e2b_api_key
        elif user_settings.sandbox_provider == SandboxProviderType.MODAL.value:
            api_key = user_settings.modal_api_key

        provider = create_sandbox_provider(
            provider_type=user_settings.sandbox_provider,
            api_key=api_key,
        )
        return SandboxService(provider, session_factory=session_factory)

    async def execute(
        self,
        task: Any,
        task_id: str,
        execution_id: str,
    ) -> dict[str, Any]:
        sandbox_service: SandboxService | None = None
        sandbox_id: str | None = None

        async with get_celery_session() as (session_factory, _):
            try:
                task_uuid = UUID(task_id)
                execution_uuid = UUID(execution_id)

                async with session_factory() as db:
                    scheduled_task = await db.get(ScheduledTask, task_uuid)
                    if not scheduled_task:
                        return {"error": "Task not found"}

                    execution = await db.get(TaskExecution, execution_uuid)
                    if not execution or execution.task_id != scheduled_task.id:
                        return {"error": "Execution not found"}

                    if execution.status != TaskExecutionStatus.RUNNING:
                        return {"status": "skipped", "reason": "execution_not_running"}

                    user = await db.get(User, scheduled_task.user_id)
                    if not user:
                        return {"error": "User not found"}

                    user_settings = cast(
                        UserSettings,
                        await UserService().get_user_settings(user.id, db=db),
                    )
                    if not scheduled_task.model_id:
                        raise SchedulerException("Scheduled task missing model_id")
                    model_id = scheduled_task.model_id

                    try:
                        validate_model_api_keys(user_settings, model_id)
                    except (ValueError, APIKeyValidationError) as exc:
                        self._mark_execution(
                            execution, TaskExecutionStatus.FAILED, str(exc)
                        )
                        self._finalize_task(scheduled_task, success=False)
                        db.add_all([execution, scheduled_task])
                        await db.commit()
                        return {"error": str(exc)}

                sandbox_service = self._create_sandbox(user_settings, session_factory)
                sandbox_id = await sandbox_service.create_sandbox()

                await sandbox_service.initialize_sandbox(
                    sandbox_id=sandbox_id,
                    github_token=user_settings.github_personal_access_token,
                    custom_env_vars=user_settings.custom_env_vars,
                    custom_skills=user_settings.custom_skills,
                    custom_slash_commands=user_settings.custom_slash_commands,
                    custom_agents=user_settings.custom_agents,
                    user_id=str(user.id),
                    auto_compact_disabled=user_settings.auto_compact_disabled,
                    attribution_disabled=user_settings.attribution_disabled,
                    custom_providers=user_settings.custom_providers,
                    gmail_oauth_client=user_settings.gmail_oauth_client,
                    gmail_oauth_tokens=user_settings.gmail_oauth_tokens,
                )

                async with session_factory() as db:
                    sandbox_provider = user_settings.sandbox_provider or "docker"
                    chat = Chat(
                        title=scheduled_task.task_name,
                        user_id=user.id,
                        sandbox_id=sandbox_id,
                        sandbox_provider=sandbox_provider,
                    )
                    db.add(chat)
                    await db.flush()

                    user_message = Message(
                        chat_id=chat.id,
                        content_text=scheduled_task.prompt_message,
                        content_render={
                            "events": [
                                {
                                    "type": "user_text",
                                    "text": scheduled_task.prompt_message,
                                }
                            ],
                            "segments": [],
                        },
                        last_seq=0,
                        active_stream_id=None,
                        role=MessageRole.USER,
                    )
                    assistant_message = Message(
                        chat_id=chat.id,
                        content_text="",
                        content_render={"events": [], "segments": []},
                        last_seq=0,
                        active_stream_id=None,
                        role=MessageRole.ASSISTANT,
                        model_id=scheduled_task.model_id,
                        stream_status=MessageStreamStatus.IN_PROGRESS,
                    )
                    db.add_all([user_message, assistant_message])
                    await db.flush()

                    execution = await db.get(TaskExecution, execution_uuid)
                    if execution:
                        execution.chat_id = chat.id
                        db.add(execution)
                    await db.commit()

                chat_data = {
                    "id": str(chat.id),
                    "user_id": str(user.id),
                    "title": chat.title,
                    "sandbox_id": sandbox_id,
                    "session_id": None,
                }

                system_prompt = build_system_prompt_for_chat(sandbox_id, user_settings)

                await StreamOrchestrator.run_chat_stream(
                    task,
                    prompt=scheduled_task.prompt_message,
                    system_prompt=system_prompt,
                    custom_instructions=user_settings.custom_instructions,
                    chat_data=chat_data,
                    model_id=model_id,
                    sandbox_service=sandbox_service,
                    session_factory=session_factory,
                    permission_mode="auto",
                    session_id=None,
                    assistant_message_id=str(assistant_message.id),
                    thinking_mode="ultra",
                    attachments=None,
                )

                async with session_factory() as db:
                    execution = await db.get(TaskExecution, execution_uuid)
                    scheduled_task = await db.get(ScheduledTask, task_uuid)
                    if execution and scheduled_task:
                        self._mark_execution(execution, TaskExecutionStatus.SUCCESS)
                        self._finalize_task(scheduled_task, success=True)
                        db.add_all([execution, scheduled_task])
                        await db.commit()

                return {
                    "status": "success",
                    "task_id": task_id,
                    "chat_id": str(chat.id),
                    "execution_id": str(execution_uuid),
                }

            except Exception as exc:
                logger.error("Fatal error in execute_scheduled_task: %s", exc)
                message = (
                    exc.message if isinstance(exc, SchedulerException) else str(exc)
                )
                async with session_factory() as db:
                    execution = await db.get(TaskExecution, UUID(execution_id))
                    scheduled_task = await db.get(ScheduledTask, UUID(task_id))
                    if execution and scheduled_task:
                        self._mark_execution(
                            execution, TaskExecutionStatus.FAILED, message
                        )
                        self._finalize_task(scheduled_task, success=False)
                        db.add_all([execution, scheduled_task])
                        await db.commit()
                return {"error": message}

            finally:
                if sandbox_service is not None:
                    try:
                        if sandbox_id is not None:
                            await sandbox_service.delete_sandbox(sandbox_id)
                        await sandbox_service.cleanup()
                    except Exception:
                        logger.exception("Failed to clean up sandbox")
