from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    get_git_service,
    get_sandbox_service,
    get_search_service,
    get_user_service,
    validate_sandbox_ownership,
)
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.db_models.user import User
from app.models.schemas.sandbox import (
    AddSecretRequest,
    FileContentResponse,
    FileMetadata,
    GitBranchesResponse,
    GitCheckoutRequest,
    GitCheckoutResponse,
    GitCommandResponse,
    GitChangedPathsResponse,
    GitCommitRequest,
    GitCreateBranchRequest,
    GitCreateBranchResponse,
    GitDiffResponse,
    GitFileBaselineResponse,
    GitRemoteUrlResponse,
    GitRestoreFileRequest,
    SandboxFilesMetadataResponse,
    SearchResponse,
    UpdateFileRequest,
    UpdateFileResponse,
    UpdateSecretRequest,
)
from app.models.schemas.secrets import (
    MessageResponse,
    SecretResponse,
    SecretsListResponse,
)
from app.services.exceptions import SandboxException
from app.services.git import GitService
from app.services.sandbox import SandboxService
from app.services.search import SearchService
from app.services.user import UserService
from app.utils.sandbox import normalize_relative_path


router = APIRouter()


@router.get(
    "/{sandbox_id}/files/metadata",
    response_model=SandboxFilesMetadataResponse,
)
async def get_files_metadata(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
    cwd: str | None = Query(None),
) -> SandboxFilesMetadataResponse:
    try:
        normalized_cwd = normalize_relative_path(cwd)
        files = await sandbox_service.get_files_metadata(sandbox_id, normalized_cwd)
        return SandboxFilesMetadataResponse(files=[FileMetadata(**f) for f in files])
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except SandboxException as e:
        raise HTTPException(
            status_code=e.status_code,
            detail=str(e),
        )


@router.get(
    "/{sandbox_id}/files/content/{file_path:path}", response_model=FileContentResponse
)
async def get_file_content(
    file_path: str,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> FileContentResponse:
    try:
        normalized_path = normalize_relative_path(file_path)
        file_data = await sandbox_service.get_file_content(sandbox_id, normalized_path)
        return FileContentResponse(**file_data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.put("/{sandbox_id}/files", response_model=UpdateFileResponse)
async def update_file_in_sandbox(
    request: UpdateFileRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> UpdateFileResponse:
    try:
        normalized_path = normalize_relative_path(request.file_path)
        await sandbox_service.provider.write_file(
            sandbox_id, normalized_path, request.content
        )
        return UpdateFileResponse(
            success=True, message=f"File {normalized_path} updated successfully"
        )
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/secrets", response_model=SecretsListResponse)
async def get_secrets(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> SecretsListResponse:
    user_settings = await user_service.get_user_settings(current_user.id, db=db)
    env_vars = user_settings.custom_env_vars or []
    return SecretsListResponse(
        secrets=[SecretResponse(key=ev["key"], value=ev["value"]) for ev in env_vars]
    )


@router.post("/{sandbox_id}/secrets", response_model=MessageResponse)
async def add_secret(
    secret_data: AddSecretRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> MessageResponse:
    user_settings = await user_service.get_user_settings(current_user.id, db=db)
    env_vars = list(user_settings.custom_env_vars or [])
    env_vars.append({"key": secret_data.key, "value": secret_data.value})
    await user_service.update_user_settings(
        current_user.id, {"custom_env_vars": env_vars}, db=db
    )
    return MessageResponse(message=f"Secret {secret_data.key} added successfully")


@router.put("/{sandbox_id}/secrets/{key}", response_model=MessageResponse)
async def update_secret(
    key: str,
    secret_data: UpdateSecretRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> MessageResponse:
    user_settings = await user_service.get_user_settings(current_user.id, db=db)
    env_vars = list(user_settings.custom_env_vars or [])
    # Update existing or append new
    found = False
    for ev in env_vars:
        if ev["key"] == key:
            ev["value"] = secret_data.value
            found = True
            break
    if not found:
        env_vars.append({"key": key, "value": secret_data.value})
    await user_service.update_user_settings(
        current_user.id, {"custom_env_vars": env_vars}, db=db
    )
    return MessageResponse(message=f"Secret {key} updated successfully")


@router.delete("/{sandbox_id}/secrets/{key}", response_model=MessageResponse)
async def delete_secret(
    key: str,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> MessageResponse:
    user_settings = await user_service.get_user_settings(current_user.id, db=db)
    env_vars = [ev for ev in (user_settings.custom_env_vars or []) if ev["key"] != key]
    await user_service.update_user_settings(
        current_user.id, {"custom_env_vars": env_vars}, db=db
    )
    return MessageResponse(message=f"Secret {key} deleted successfully")


@router.get("/{sandbox_id}/download-zip")
async def download_sandbox_files(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> Response:
    try:
        zip_bytes = await sandbox_service.generate_zip_download(sandbox_id)
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="sandbox_{sandbox_id}.zip"'
            },
        )
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/git/diff", response_model=GitDiffResponse)
async def get_git_diff(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
    mode: Literal["all", "staged", "unstaged", "branch"] = Query("all"),
    full_context: bool = Query(False),
    cwd: str | None = Query(None),
) -> GitDiffResponse:
    try:
        return await git_service.get_diff(sandbox_id, mode, full_context, cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/git/changed-paths", response_model=GitChangedPathsResponse)
async def get_git_changed_paths(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
    cwd: str | None = Query(None),
) -> GitChangedPathsResponse:
    try:
        return await git_service.get_changed_paths(sandbox_id, cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/git/file-baseline", response_model=GitFileBaselineResponse)
async def get_git_file_baseline(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
    path: str = Query(..., min_length=1, max_length=1024),
    cwd: str | None = Query(None),
) -> GitFileBaselineResponse:
    try:
        return await git_service.get_file_baseline(sandbox_id, path, cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/git/branches", response_model=GitBranchesResponse)
async def get_git_branches(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
    cwd: str | None = Query(None),
) -> GitBranchesResponse:
    try:
        return await git_service.get_branches(sandbox_id, cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/git/checkout", response_model=GitCheckoutResponse)
async def checkout_git_branch(
    request: GitCheckoutRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
) -> GitCheckoutResponse:
    try:
        return await git_service.checkout(sandbox_id, request.branch, request.cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/git/push", response_model=GitCommandResponse)
async def git_push(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
    cwd: str | None = Query(None),
) -> GitCommandResponse:
    try:
        return await git_service.push(sandbox_id, cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/git/pull", response_model=GitCommandResponse)
async def git_pull(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
    cwd: str | None = Query(None),
) -> GitCommandResponse:
    try:
        return await git_service.pull(sandbox_id, cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/git/commit", response_model=GitCommandResponse)
async def git_commit(
    request: GitCommitRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
) -> GitCommandResponse:
    try:
        return await git_service.commit(sandbox_id, request.message, request.cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/git/restore-file", response_model=GitCommandResponse)
async def git_restore_file(
    request: GitRestoreFileRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
) -> GitCommandResponse:
    try:
        return await git_service.restore_file(
            sandbox_id, request.file_path, request.old_path, request.cwd
        )
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/git/restore-all", response_model=GitCommandResponse)
async def git_restore_all(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
    cwd: str | None = Query(None),
) -> GitCommandResponse:
    try:
        return await git_service.restore_all(sandbox_id, cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/git/create-branch", response_model=GitCreateBranchResponse)
async def create_git_branch(
    request: GitCreateBranchRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
) -> GitCreateBranchResponse:
    try:
        return await git_service.create_branch(
            sandbox_id, request.name, request.base_branch, request.cwd
        )
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/git/remote-url", response_model=GitRemoteUrlResponse)
async def get_git_remote_url(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    git_service: GitService = Depends(get_git_service),
    cwd: str | None = Query(None),
) -> GitRemoteUrlResponse:
    try:
        return await git_service.get_remote_url(sandbox_id, cwd)
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/search", response_model=SearchResponse)
async def search_in_files(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    search_service: SearchService = Depends(get_search_service),
    q: str = Query(..., min_length=1, max_length=500),
    cwd: str | None = Query(None),
    case_sensitive: bool = Query(False),
    regex: bool = Query(False),
    whole_word: bool = Query(False),
    include: str | None = Query(None, max_length=200),
    exclude: str | None = Query(None, max_length=200),
) -> SearchResponse:
    try:
        return await search_service.search(
            sandbox_id,
            q,
            cwd,
            case_sensitive=case_sensitive,
            regex=regex,
            whole_word=whole_word,
            include_glob=include,
            exclude_glob=exclude,
        )
    except (ValueError, SandboxException) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
