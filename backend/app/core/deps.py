from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.core.user_manager import optional_current_active_user
from app.db.session import SessionLocal, get_db
from app.models.db_models import Chat, User
from app.actions.chat.cancel_stream import CancelStreamAction
from app.actions.chat.clear_queue import ClearQueueAction
from app.actions.chat.create_chat import CreateChatAction
from app.actions.chat.delete_all_chats import DeleteAllChatsAction
from app.actions.chat.delete_chat import DeleteChatAction
from app.actions.chat.enhance_prompt import EnhancePromptAction
from app.actions.chat.fork_chat import ForkChatAction
from app.actions.chat.get_chat_context_usage import GetChatContextUsageAction
from app.actions.chat.get_chat_detail import GetChatDetailAction
from app.actions.chat.get_chat_messages import GetChatMessagesAction
from app.actions.chat.get_chats import GetChatsAction
from app.actions.chat.get_message_events import GetMessageEventsAction
from app.actions.chat.get_queue import GetQueueAction
from app.actions.chat.get_stream_status import GetStreamStatusAction
from app.actions.chat.respond_permission import RespondPermissionAction
from app.actions.chat.restore_chat import RestoreChatAction
from app.actions.chat.send_message import SendMessageAction
from app.actions.chat.stream_events import StreamEventsAction
from app.actions.chat.update_chat import UpdateChatAction
from app.actions.chat.update_queued_message import UpdateQueuedMessageAction
from app.actions.ai_model import ListModelsAction
from app.actions.agents import DeleteAgentAction, UpdateAgentAction, UploadAgentAction
from app.actions.auth import (
    GetUserUsageAction,
    LoginAction,
    LogoutAction,
    RefreshAccessTokenAction,
    RegisterAction,
)
from app.actions.attachments import (
    DownloadAttachmentAction,
    PreviewAttachmentAction,
    PreviewTempAttachmentAction,
)
from app.actions.commands import (
    DeleteCommandAction,
    UpdateCommandAction,
    UploadCommandAction,
)
from app.actions.integrations import (
    DeleteOAuthClientAction,
    DisconnectGmailAction,
    GetGmailStatusAction,
    GetOAuthUrlAction,
    OAuthCallbackAction,
    PollOpenAITokenAction,
    PollTokenAction,
    StartDeviceFlowAction,
    StartOpenAIDeviceFlowAction,
    UploadOAuthClientAction,
)
from app.actions.marketplace import (
    GetCatalogAction,
    GetInstalledPluginsAction,
    GetPluginDetailsAction,
    InstallPluginComponentsAction,
    UninstallPluginComponentsAction,
)
from app.actions.mcps import CreateMcpAction, DeleteMcpAction, UpdateMcpAction
from app.actions.permissions import (
    CreatePermissionRequestAction,
    GetPermissionResponseAction,
)
from app.actions.queue.queue_message import QueueMessageAction
from app.actions.sandbox import (
    AddSecretAction,
    DeleteSecretAction,
    DownloadSandboxFilesAction,
    GetBrowserStatusAction,
    GetFileContentAction,
    GetFilesMetadataAction,
    GetIdeUrlAction,
    GetPreviewLinksAction,
    GetSecretsAction,
    GetVncUrlAction,
    StartBrowserAction,
    StopBrowserAction,
    UpdateFileAction,
    UpdateIdeThemeAction,
    UpdateSecretAction,
)
from app.actions.scheduler.create_scheduled_task import CreateScheduledTaskAction
from app.actions.scheduler.delete_scheduled_task import DeleteScheduledTaskAction
from app.actions.scheduler.get_scheduled_task import GetScheduledTaskAction
from app.actions.scheduler.get_scheduled_tasks import GetScheduledTasksAction
from app.actions.scheduler.get_task_execution_history import (
    GetTaskExecutionHistoryAction,
)
from app.actions.scheduler.toggle_scheduled_task import ToggleScheduledTaskAction
from app.actions.scheduler.update_scheduled_task import UpdateScheduledTaskAction
from app.actions.settings import GetUserSettingsAction, UpdateUserSettingsAction
from app.actions.skills import DeleteSkillAction, UploadSkillAction
from app.services.agent import AgentService
from app.services.chat import ChatService
from app.services.provider import ProviderService
from app.services.claude_agent import ClaudeAgentService
from app.services.command import CommandService
from app.services.exceptions import UserException
from app.services.message import MessageService
from app.services.refresh_token import RefreshTokenService
from app.services.sandbox import SandboxService
from app.services.sandbox_providers import SandboxProviderType, create_sandbox_provider
from app.services.scheduler import SchedulerService
from app.services.marketplace import MarketplaceService
from app.services.plugin_installer import PluginInstallerService
from app.services.skill import SkillService
from app.services.storage import StorageService
from app.services.user import UserService


def get_provider_service() -> ProviderService:
    return ProviderService()


def get_message_service() -> MessageService:
    return MessageService(session_factory=SessionLocal)


def get_user_service() -> UserService:
    return UserService(session_factory=SessionLocal)


def get_refresh_token_service() -> RefreshTokenService:
    return RefreshTokenService(session_factory=SessionLocal)


def get_login_action(
    refresh_token_service: RefreshTokenService = Depends(get_refresh_token_service),
) -> LoginAction:
    return LoginAction(refresh_token_service)


def get_register_action() -> RegisterAction:
    return RegisterAction()


def get_user_usage_action(
    user_service: UserService = Depends(get_user_service),
) -> GetUserUsageAction:
    return GetUserUsageAction(user_service)


def get_refresh_access_token_action(
    refresh_token_service: RefreshTokenService = Depends(get_refresh_token_service),
) -> RefreshAccessTokenAction:
    return RefreshAccessTokenAction(refresh_token_service)


def get_logout_action(
    refresh_token_service: RefreshTokenService = Depends(get_refresh_token_service),
) -> LogoutAction:
    return LogoutAction(refresh_token_service)


def get_skill_service() -> SkillService:
    return SkillService()


def get_command_service() -> CommandService:
    return CommandService()


def get_agent_service() -> AgentService:
    return AgentService()


async def get_github_token(
    user: User | None = Depends(optional_current_active_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> str | None:
    if user is None:
        return None
    try:
        user_settings = await user_service.get_user_settings(user.id, db=db)
        token = user_settings.github_personal_access_token
        return token if token else None
    except UserException:
        return None


async def get_marketplace_service(
    github_token: str | None = Depends(get_github_token),
) -> MarketplaceService:
    return MarketplaceService(github_token=github_token)


async def get_plugin_installer_service(
    github_token: str | None = Depends(get_github_token),
) -> PluginInstallerService:
    return PluginInstallerService(github_token=github_token)


def get_scheduler_service() -> SchedulerService:
    return SchedulerService(session_factory=SessionLocal)


async def validate_sandbox_ownership(
    sandbox_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> str:
    query = select(Chat.sandbox_id).where(
        Chat.sandbox_id == sandbox_id,
        Chat.user_id == current_user.id,
        Chat.deleted_at.is_(None),
    )
    result = await db.execute(query)
    if not result.one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sandbox not found",
        )
    return sandbox_id


async def get_sandbox_service(
    request: Request,
    user: User | None = Depends(optional_current_active_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> AsyncIterator[SandboxService]:
    provider_type = SandboxProviderType.DOCKER
    e2b_api_key = None
    modal_api_key = None

    sandbox_id = request.path_params.get("sandbox_id")
    if sandbox_id:
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
            )
        query = select(Chat.sandbox_provider).where(
            Chat.sandbox_id == sandbox_id,
            Chat.user_id == user.id,
            Chat.deleted_at.is_(None),
        )
        result = await db.execute(query)
        row = result.one_or_none()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sandbox not found",
            )
        sandbox_provider = row.sandbox_provider
    else:
        sandbox_provider = None

    if user:
        try:
            user_settings = await user_service.get_user_settings(user.id, db=db)
            if user_settings.sandbox_provider:
                provider_type = SandboxProviderType(user_settings.sandbox_provider)
            if user_settings.e2b_api_key:
                e2b_api_key = user_settings.e2b_api_key
            if user_settings.modal_api_key:
                modal_api_key = user_settings.modal_api_key
        except UserException:
            pass

    if sandbox_provider:
        provider_type = SandboxProviderType(sandbox_provider)

    api_key = None
    if provider_type == SandboxProviderType.E2B:
        api_key = e2b_api_key
    elif provider_type == SandboxProviderType.MODAL:
        api_key = modal_api_key

    provider = create_sandbox_provider(
        provider_type=provider_type,
        api_key=api_key,
    )
    try:
        yield SandboxService(provider)
    finally:
        await provider.cleanup()


async def get_storage_service(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> StorageService:
    return StorageService(sandbox_service)


async def get_chat_service(
    file_service: StorageService = Depends(get_storage_service),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
    user_service: UserService = Depends(get_user_service),
) -> AsyncIterator[ChatService]:
    async with ClaudeAgentService(session_factory=SessionLocal) as ai_service:
        yield ChatService(
            file_service,
            sandbox_service,
            ai_service,
            user_service,
            session_factory=SessionLocal,
        )


async def get_create_chat_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> CreateChatAction:
    return CreateChatAction(chat_service)


async def get_send_message_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> SendMessageAction:
    return SendMessageAction(chat_service)


async def get_queue_message_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> QueueMessageAction:
    return QueueMessageAction(chat_service)


async def get_delete_chat_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> DeleteChatAction:
    return DeleteChatAction(chat_service)


async def get_delete_all_chats_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> DeleteAllChatsAction:
    return DeleteAllChatsAction(chat_service)


async def get_restore_chat_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> RestoreChatAction:
    return RestoreChatAction(chat_service)


async def get_fork_chat_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> ForkChatAction:
    return ForkChatAction(chat_service)


async def get_get_stream_status_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> GetStreamStatusAction:
    return GetStreamStatusAction(chat_service)


async def get_cancel_stream_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> CancelStreamAction:
    return CancelStreamAction(chat_service)


async def get_respond_permission_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> RespondPermissionAction:
    return RespondPermissionAction(chat_service)


async def get_stream_events_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> StreamEventsAction:
    return StreamEventsAction(chat_service)


async def get_message_events_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> GetMessageEventsAction:
    return GetMessageEventsAction(chat_service)


async def get_get_queue_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> GetQueueAction:
    return GetQueueAction(chat_service)


async def get_update_queued_message_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> UpdateQueuedMessageAction:
    return UpdateQueuedMessageAction(chat_service)


async def get_clear_queue_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> ClearQueueAction:
    return ClearQueueAction(chat_service)


async def get_chat_context_usage_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> GetChatContextUsageAction:
    return GetChatContextUsageAction(chat_service)


def get_create_scheduled_task_action(
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> CreateScheduledTaskAction:
    return CreateScheduledTaskAction(scheduler_service)


def get_scheduled_tasks_action(
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> GetScheduledTasksAction:
    return GetScheduledTasksAction(scheduler_service)


def get_scheduled_task_action(
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> GetScheduledTaskAction:
    return GetScheduledTaskAction(scheduler_service)


def get_update_scheduled_task_action(
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> UpdateScheduledTaskAction:
    return UpdateScheduledTaskAction(scheduler_service)


def get_delete_scheduled_task_action(
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> DeleteScheduledTaskAction:
    return DeleteScheduledTaskAction(scheduler_service)


def get_toggle_scheduled_task_action(
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> ToggleScheduledTaskAction:
    return ToggleScheduledTaskAction(scheduler_service)


def get_task_execution_history_action(
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> GetTaskExecutionHistoryAction:
    return GetTaskExecutionHistoryAction(scheduler_service)


async def get_enhance_prompt_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> EnhancePromptAction:
    return EnhancePromptAction(chat_service)


async def get_get_chats_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> GetChatsAction:
    return GetChatsAction(chat_service)


async def get_get_chat_detail_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> GetChatDetailAction:
    return GetChatDetailAction(chat_service)


async def get_update_chat_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> UpdateChatAction:
    return UpdateChatAction(chat_service)


async def get_chat_messages_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> GetChatMessagesAction:
    return GetChatMessagesAction(chat_service)


def get_list_models_action(
    provider_service: ProviderService = Depends(get_provider_service),
    user_service: UserService = Depends(get_user_service),
) -> ListModelsAction:
    return ListModelsAction(provider_service, user_service)


def get_upload_oauth_client_action(
    user_service: UserService = Depends(get_user_service),
) -> UploadOAuthClientAction:
    return UploadOAuthClientAction(user_service)


def get_delete_oauth_client_action(
    user_service: UserService = Depends(get_user_service),
) -> DeleteOAuthClientAction:
    return DeleteOAuthClientAction(user_service)


def get_oauth_url_action(
    user_service: UserService = Depends(get_user_service),
) -> GetOAuthUrlAction:
    return GetOAuthUrlAction(user_service)


def get_oauth_callback_action(
    user_service: UserService = Depends(get_user_service),
) -> OAuthCallbackAction:
    return OAuthCallbackAction(user_service)


def get_gmail_status_action(
    user_service: UserService = Depends(get_user_service),
) -> GetGmailStatusAction:
    return GetGmailStatusAction(user_service)


def get_disconnect_gmail_action(
    user_service: UserService = Depends(get_user_service),
) -> DisconnectGmailAction:
    return DisconnectGmailAction(user_service)


def get_start_device_flow_action() -> StartDeviceFlowAction:
    return StartDeviceFlowAction()


def get_poll_token_action() -> PollTokenAction:
    return PollTokenAction()


def get_start_openai_device_flow_action() -> StartOpenAIDeviceFlowAction:
    return StartOpenAIDeviceFlowAction()


def get_poll_openai_token_action() -> PollOpenAITokenAction:
    return PollOpenAITokenAction()


def get_create_mcp_action(
    user_service: UserService = Depends(get_user_service),
) -> CreateMcpAction:
    return CreateMcpAction(user_service)


def get_update_mcp_action(
    user_service: UserService = Depends(get_user_service),
) -> UpdateMcpAction:
    return UpdateMcpAction(user_service)


def get_delete_mcp_action(
    user_service: UserService = Depends(get_user_service),
) -> DeleteMcpAction:
    return DeleteMcpAction(user_service)


def get_create_permission_request_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> CreatePermissionRequestAction:
    return CreatePermissionRequestAction(chat_service)


def get_get_permission_response_action() -> GetPermissionResponseAction:
    return GetPermissionResponseAction()


def get_get_user_settings_action(
    user_service: UserService = Depends(get_user_service),
) -> GetUserSettingsAction:
    return GetUserSettingsAction(user_service)


def get_update_user_settings_action(
    user_service: UserService = Depends(get_user_service),
) -> UpdateUserSettingsAction:
    return UpdateUserSettingsAction(user_service)


async def get_get_catalog_action(
    marketplace_service: MarketplaceService = Depends(get_marketplace_service),
    user_service: UserService = Depends(get_user_service),
    installer_service: PluginInstallerService = Depends(get_plugin_installer_service),
    agent_service: AgentService = Depends(get_agent_service),
    command_service: CommandService = Depends(get_command_service),
    skill_service: SkillService = Depends(get_skill_service),
) -> GetCatalogAction:
    return GetCatalogAction(
        marketplace_service,
        user_service,
        installer_service,
        agent_service,
        command_service,
        skill_service,
    )


async def get_get_plugin_details_action(
    marketplace_service: MarketplaceService = Depends(get_marketplace_service),
    user_service: UserService = Depends(get_user_service),
    installer_service: PluginInstallerService = Depends(get_plugin_installer_service),
    agent_service: AgentService = Depends(get_agent_service),
    command_service: CommandService = Depends(get_command_service),
    skill_service: SkillService = Depends(get_skill_service),
) -> GetPluginDetailsAction:
    return GetPluginDetailsAction(
        marketplace_service,
        user_service,
        installer_service,
        agent_service,
        command_service,
        skill_service,
    )


async def get_install_plugin_components_action(
    marketplace_service: MarketplaceService = Depends(get_marketplace_service),
    user_service: UserService = Depends(get_user_service),
    installer_service: PluginInstallerService = Depends(get_plugin_installer_service),
    agent_service: AgentService = Depends(get_agent_service),
    command_service: CommandService = Depends(get_command_service),
    skill_service: SkillService = Depends(get_skill_service),
) -> InstallPluginComponentsAction:
    return InstallPluginComponentsAction(
        marketplace_service,
        user_service,
        installer_service,
        agent_service,
        command_service,
        skill_service,
    )


async def get_get_installed_plugins_action(
    marketplace_service: MarketplaceService = Depends(get_marketplace_service),
    user_service: UserService = Depends(get_user_service),
    installer_service: PluginInstallerService = Depends(get_plugin_installer_service),
    agent_service: AgentService = Depends(get_agent_service),
    command_service: CommandService = Depends(get_command_service),
    skill_service: SkillService = Depends(get_skill_service),
) -> GetInstalledPluginsAction:
    return GetInstalledPluginsAction(
        marketplace_service,
        user_service,
        installer_service,
        agent_service,
        command_service,
        skill_service,
    )


async def get_uninstall_plugin_components_action(
    marketplace_service: MarketplaceService = Depends(get_marketplace_service),
    user_service: UserService = Depends(get_user_service),
    installer_service: PluginInstallerService = Depends(get_plugin_installer_service),
    agent_service: AgentService = Depends(get_agent_service),
    command_service: CommandService = Depends(get_command_service),
    skill_service: SkillService = Depends(get_skill_service),
) -> UninstallPluginComponentsAction:
    return UninstallPluginComponentsAction(
        marketplace_service,
        user_service,
        installer_service,
        agent_service,
        command_service,
        skill_service,
    )


def get_upload_agent_action(
    agent_service: AgentService = Depends(get_agent_service),
    user_service: UserService = Depends(get_user_service),
) -> UploadAgentAction:
    return UploadAgentAction(agent_service, user_service)


def get_update_agent_action(
    agent_service: AgentService = Depends(get_agent_service),
    user_service: UserService = Depends(get_user_service),
) -> UpdateAgentAction:
    return UpdateAgentAction(agent_service, user_service)


def get_delete_agent_action(
    agent_service: AgentService = Depends(get_agent_service),
    user_service: UserService = Depends(get_user_service),
) -> DeleteAgentAction:
    return DeleteAgentAction(agent_service, user_service)


def get_upload_command_action(
    command_service: CommandService = Depends(get_command_service),
    user_service: UserService = Depends(get_user_service),
) -> UploadCommandAction:
    return UploadCommandAction(command_service, user_service)


def get_update_command_action(
    command_service: CommandService = Depends(get_command_service),
    user_service: UserService = Depends(get_user_service),
) -> UpdateCommandAction:
    return UpdateCommandAction(command_service, user_service)


def get_delete_command_action(
    command_service: CommandService = Depends(get_command_service),
    user_service: UserService = Depends(get_user_service),
) -> DeleteCommandAction:
    return DeleteCommandAction(command_service, user_service)


async def get_preview_links_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GetPreviewLinksAction:
    return GetPreviewLinksAction(sandbox_service)


async def get_ide_url_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GetIdeUrlAction:
    return GetIdeUrlAction(sandbox_service)


async def get_vnc_url_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GetVncUrlAction:
    return GetVncUrlAction(sandbox_service)


async def get_start_browser_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> StartBrowserAction:
    return StartBrowserAction(sandbox_service)


async def get_stop_browser_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> StopBrowserAction:
    return StopBrowserAction(sandbox_service)


async def get_browser_status_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GetBrowserStatusAction:
    return GetBrowserStatusAction(sandbox_service)


async def get_files_metadata_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GetFilesMetadataAction:
    return GetFilesMetadataAction(sandbox_service)


async def get_file_content_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GetFileContentAction:
    return GetFileContentAction(sandbox_service)


async def get_update_file_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> UpdateFileAction:
    return UpdateFileAction(sandbox_service)


async def get_secrets_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GetSecretsAction:
    return GetSecretsAction(sandbox_service)


async def get_add_secret_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> AddSecretAction:
    return AddSecretAction(sandbox_service)


async def get_update_secret_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> UpdateSecretAction:
    return UpdateSecretAction(sandbox_service)


async def get_delete_secret_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> DeleteSecretAction:
    return DeleteSecretAction(sandbox_service)


async def get_update_ide_theme_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> UpdateIdeThemeAction:
    return UpdateIdeThemeAction(sandbox_service)


async def get_download_sandbox_files_action(
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> DownloadSandboxFilesAction:
    return DownloadSandboxFilesAction(sandbox_service)


def get_upload_skill_action(
    skill_service: SkillService = Depends(get_skill_service),
    user_service: UserService = Depends(get_user_service),
) -> UploadSkillAction:
    return UploadSkillAction(skill_service, user_service)


def get_delete_skill_action(
    skill_service: SkillService = Depends(get_skill_service),
    user_service: UserService = Depends(get_user_service),
) -> DeleteSkillAction:
    return DeleteSkillAction(skill_service, user_service)


def get_preview_temp_attachment_action() -> PreviewTempAttachmentAction:
    return PreviewTempAttachmentAction()


async def get_preview_attachment_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> PreviewAttachmentAction:
    return PreviewAttachmentAction(chat_service)


async def get_download_attachment_action(
    chat_service: ChatService = Depends(get_chat_service),
) -> DownloadAttachmentAction:
    return DownloadAttachmentAction(chat_service)
