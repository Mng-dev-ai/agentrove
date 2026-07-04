from typing import Literal

from pydantic import BaseModel, Field


class UpdateFileRequest(BaseModel):
    file_path: str = Field(..., min_length=1, max_length=4096)
    content: str


class UpdateFileResponse(BaseModel):
    success: bool
    message: str


class FileMetadata(BaseModel):
    path: str
    type: str
    is_binary: bool | None = None


class SandboxFilesMetadataResponse(BaseModel):
    files: list[FileMetadata]


class FileContentResponse(BaseModel):
    content: str
    path: str
    type: str
    is_binary: bool


class AddSecretRequest(BaseModel):
    key: str = Field(..., min_length=1)
    value: str = Field(..., min_length=1)


class UpdateSecretRequest(BaseModel):
    value: str = Field(..., min_length=1)


class GitDiffResponse(BaseModel):
    diff: str
    has_changes: bool
    is_git_repo: bool
    error: str | None = None


class GitFileBaselineResponse(BaseModel):
    path: str
    content: str
    is_git_repo: bool


class GitChangedPathsResponse(BaseModel):
    paths: list[str]
    is_git_repo: bool


class GitBranchesResponse(BaseModel):
    branches: list[str]
    current_branch: str
    is_git_repo: bool


class GitCheckoutRequest(BaseModel):
    branch: str = Field(..., min_length=1, max_length=256)
    cwd: str | None = None


class GitCheckoutResponse(BaseModel):
    success: bool
    current_branch: str
    error: str | None = None


class GitCreateBranchRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    base_branch: str | None = None
    cwd: str | None = None


class GitCreateBranchResponse(BaseModel):
    success: bool
    current_branch: str
    error: str | None = None


class GitCommitRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    cwd: str | None = None


class GitRestoreFileRequest(BaseModel):
    file_path: str = Field(..., min_length=1, max_length=4096)
    # Pre-rename path, when the change is a rename; None otherwise.
    old_path: str | None = Field(default=None, min_length=1, max_length=4096)
    cwd: str | None = None


class GitCommandResponse(BaseModel):
    success: bool
    output: str
    error: str | None = None


class GitRemoteUrlResponse(BaseModel):
    owner: str
    repo: str
    remote_url: str


class ChangedFile(BaseModel):
    path: str
    status: Literal["M", "A", "D"]
    additions: int
    deletions: int


class ChangedFilesResponse(BaseModel):
    files: list[ChangedFile]
    # Workspace-root-relative cwd the file paths are reported against — the
    # frontend joins it onto each path to navigate the editor (which keys on
    # workspace-root paths). Empty for non-worktree chats.
    cwd: str = ""


class FileDiffResponse(BaseModel):
    path: str
    diff: str


class SearchMatch(BaseModel):
    line_number: int
    line_text: str
    match_start: int
    match_end: int


class SearchFileResult(BaseModel):
    path: str
    matches: list[SearchMatch]


class SearchResponse(BaseModel):
    results: list[SearchFileResult]
    # True when either per-file or total match caps were hit — the UI should
    # show a "showing first N" hint so the user knows there's more.
    truncated: bool
