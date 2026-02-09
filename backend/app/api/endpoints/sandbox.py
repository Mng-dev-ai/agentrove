from fastapi import APIRouter, Depends, Response

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
from app.core.deps import (
    get_add_secret_action,
    get_browser_status_action,
    get_delete_secret_action,
    get_download_sandbox_files_action,
    get_file_content_action,
    get_files_metadata_action,
    get_ide_url_action,
    get_preview_links_action,
    get_secrets_action,
    get_start_browser_action,
    get_stop_browser_action,
    get_update_file_action,
    get_update_ide_theme_action,
    get_update_secret_action,
    get_vnc_url_action,
    validate_sandbox_ownership,
)
from app.models.schemas import (
    AddSecretRequest,
    BrowserStatusResponse,
    FileContentResponse,
    IDEUrlResponse,
    MessageResponse,
    PreviewLinksResponse,
    SandboxFilesMetadataResponse,
    SecretsListResponse,
    StartBrowserRequest,
    UpdateFileRequest,
    UpdateFileResponse,
    UpdateIDEThemeRequest,
    UpdateSecretRequest,
    VNCUrlResponse,
)


router = APIRouter()


@router.get("/{sandbox_id}/preview-links", response_model=PreviewLinksResponse)
async def get_preview_links(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    preview_links_action: GetPreviewLinksAction = Depends(get_preview_links_action),
) -> PreviewLinksResponse:
    return await preview_links_action.execute(sandbox_id)


@router.get("/{sandbox_id}/ide-url", response_model=IDEUrlResponse)
async def get_ide_url(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    ide_url_action: GetIdeUrlAction = Depends(get_ide_url_action),
) -> IDEUrlResponse:
    return await ide_url_action.execute(sandbox_id)


@router.get("/{sandbox_id}/vnc-url", response_model=VNCUrlResponse)
async def get_vnc_url(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    vnc_url_action: GetVncUrlAction = Depends(get_vnc_url_action),
) -> VNCUrlResponse:
    return await vnc_url_action.execute(sandbox_id)


@router.post("/{sandbox_id}/browser/start", response_model=BrowserStatusResponse)
async def start_browser(
    request: StartBrowserRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    start_browser_action: StartBrowserAction = Depends(get_start_browser_action),
) -> BrowserStatusResponse:
    return await start_browser_action.execute(sandbox_id, request.url)


@router.post("/{sandbox_id}/browser/stop", response_model=MessageResponse)
async def stop_browser(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    stop_browser_action: StopBrowserAction = Depends(get_stop_browser_action),
) -> MessageResponse:
    return await stop_browser_action.execute(sandbox_id)


@router.get("/{sandbox_id}/browser/status", response_model=BrowserStatusResponse)
async def get_browser_status(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    browser_status_action: GetBrowserStatusAction = Depends(get_browser_status_action),
) -> BrowserStatusResponse:
    return await browser_status_action.execute(sandbox_id)


@router.get(
    "/{sandbox_id}/files/metadata",
    response_model=SandboxFilesMetadataResponse,
)
async def get_files_metadata(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    files_metadata_action: GetFilesMetadataAction = Depends(get_files_metadata_action),
) -> SandboxFilesMetadataResponse:
    return await files_metadata_action.execute(sandbox_id)


@router.get(
    "/{sandbox_id}/files/content/{file_path:path}", response_model=FileContentResponse
)
async def get_file_content(
    file_path: str,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    file_content_action: GetFileContentAction = Depends(get_file_content_action),
) -> FileContentResponse:
    return await file_content_action.execute(sandbox_id, file_path)


@router.put("/{sandbox_id}/files", response_model=UpdateFileResponse)
async def update_file_in_sandbox(
    request: UpdateFileRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    update_file_action: UpdateFileAction = Depends(get_update_file_action),
) -> UpdateFileResponse:
    return await update_file_action.execute(
        sandbox_id, request.file_path, request.content
    )


@router.get("/{sandbox_id}/secrets", response_model=SecretsListResponse)
async def get_secrets(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    secrets_action: GetSecretsAction = Depends(get_secrets_action),
) -> SecretsListResponse:
    return await secrets_action.execute(sandbox_id)


@router.post("/{sandbox_id}/secrets", response_model=MessageResponse)
async def add_secret(
    secret_data: AddSecretRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    add_secret_action: AddSecretAction = Depends(get_add_secret_action),
) -> MessageResponse:
    return await add_secret_action.execute(
        sandbox_id, secret_data.key, secret_data.value
    )


@router.put("/{sandbox_id}/secrets/{key}", response_model=MessageResponse)
async def update_secret(
    key: str,
    secret_data: UpdateSecretRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    update_secret_action: UpdateSecretAction = Depends(get_update_secret_action),
) -> MessageResponse:
    return await update_secret_action.execute(sandbox_id, key, secret_data.value)


@router.delete("/{sandbox_id}/secrets/{key}", response_model=MessageResponse)
async def delete_secret(
    key: str,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    delete_secret_action: DeleteSecretAction = Depends(get_delete_secret_action),
) -> MessageResponse:
    return await delete_secret_action.execute(sandbox_id, key)


@router.put("/{sandbox_id}/ide-theme", response_model=MessageResponse)
async def update_ide_theme(
    request: UpdateIDEThemeRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    update_ide_theme_action: UpdateIdeThemeAction = Depends(
        get_update_ide_theme_action
    ),
) -> MessageResponse:
    return await update_ide_theme_action.execute(sandbox_id, request.theme)


@router.get("/{sandbox_id}/download-zip")
async def download_sandbox_files(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    download_sandbox_files_action: DownloadSandboxFilesAction = Depends(
        get_download_sandbox_files_action
    ),
) -> Response:
    return await download_sandbox_files_action.execute(sandbox_id)
