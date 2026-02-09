from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.core.deps import (
    get_db,
    get_delete_oauth_client_action,
    get_disconnect_gmail_action,
    get_gmail_status_action,
    get_oauth_callback_action,
    get_oauth_url_action,
    get_poll_openai_token_action,
    get_poll_token_action,
    get_start_device_flow_action,
    get_start_openai_device_flow_action,
    get_upload_oauth_client_action,
)
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas.integrations import (
    DeviceCodeResponse,
    GmailStatusResponse,
    OAuthClientResponse,
    OAuthClientUploadRequest,
    OAuthUrlResponse,
    OpenAIPollTokenRequest,
    PollTokenRequest,
    PollTokenResponse,
)

router = APIRouter()


@router.post("/gmail/oauth-client", response_model=OAuthClientResponse)
async def upload_oauth_client(
    request: OAuthClientUploadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    upload_oauth_client_action: UploadOAuthClientAction = Depends(
        get_upload_oauth_client_action
    ),
) -> OAuthClientResponse:
    return await upload_oauth_client_action.execute(request, current_user, db)


@router.delete("/gmail/oauth-client", response_model=OAuthClientResponse)
async def delete_oauth_client(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    delete_oauth_client_action: DeleteOAuthClientAction = Depends(
        get_delete_oauth_client_action
    ),
) -> OAuthClientResponse:
    return await delete_oauth_client_action.execute(current_user, db)


@router.get("/gmail/oauth-url", response_model=OAuthUrlResponse)
async def get_oauth_url(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    oauth_url_action: GetOAuthUrlAction = Depends(get_oauth_url_action),
) -> OAuthUrlResponse:
    return await oauth_url_action.execute(current_user, db)


@router.get("/gmail/callback", response_class=HTMLResponse)
async def oauth_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
    oauth_callback_action: OAuthCallbackAction = Depends(get_oauth_callback_action),
) -> HTMLResponse:
    return await oauth_callback_action.execute(code, state, db)


@router.get("/gmail/status", response_model=GmailStatusResponse)
async def get_gmail_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    gmail_status_action: GetGmailStatusAction = Depends(get_gmail_status_action),
) -> GmailStatusResponse:
    return await gmail_status_action.execute(current_user, db)


@router.post("/gmail/disconnect", response_model=OAuthClientResponse)
async def disconnect_gmail(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    disconnect_gmail_action: DisconnectGmailAction = Depends(
        get_disconnect_gmail_action
    ),
) -> OAuthClientResponse:
    return await disconnect_gmail_action.execute(current_user, db)


@router.post("/copilot/device-code", response_model=DeviceCodeResponse)
async def start_device_flow(
    _current_user: User = Depends(get_current_user),
    start_device_flow_action: StartDeviceFlowAction = Depends(
        get_start_device_flow_action
    ),
) -> DeviceCodeResponse:
    return await start_device_flow_action.execute()


@router.post("/copilot/poll-token", response_model=PollTokenResponse)
async def poll_token(
    request: PollTokenRequest,
    _current_user: User = Depends(get_current_user),
    poll_token_action: PollTokenAction = Depends(get_poll_token_action),
) -> PollTokenResponse:
    return await poll_token_action.execute(request)


@router.post("/openai/device-code", response_model=DeviceCodeResponse)
async def start_openai_device_flow(
    _current_user: User = Depends(get_current_user),
    start_openai_device_flow_action: StartOpenAIDeviceFlowAction = Depends(
        get_start_openai_device_flow_action
    ),
) -> DeviceCodeResponse:
    return await start_openai_device_flow_action.execute()


@router.post("/openai/poll-token", response_model=PollTokenResponse)
async def poll_openai_token(
    request: OpenAIPollTokenRequest,
    _current_user: User = Depends(get_current_user),
    poll_openai_token_action: PollOpenAITokenAction = Depends(
        get_poll_openai_token_action
    ),
) -> PollTokenResponse:
    return await poll_openai_token_action.execute(request)
