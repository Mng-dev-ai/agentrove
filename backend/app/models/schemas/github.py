from typing import Any

from pydantic import BaseModel, Field


class GitHubRepo(BaseModel):
    name: str
    full_name: str
    description: str | None
    language: str | None
    html_url: str
    clone_url: str
    private: bool
    pushed_at: str | None
    stargazers_count: int


class GitHubReposResponse(BaseModel):
    items: list[GitHubRepo]
    has_more: bool


class GitHubPullRequest(BaseModel):
    number: int
    title: str
    body: str | None
    state: str
    html_url: str
    head: dict[str, Any]
    base: dict[str, Any]
    user: dict[str, Any]
    draft: bool
    review_comments: int


class GitHubPRListResponse(BaseModel):
    items: list[GitHubPullRequest]


class CreatePullRequestRequest(BaseModel):
    owner: str
    repo: str
    title: str
    body: str
    head: str
    base: str
    reviewers: list[str] = []


class CreatePullRequestResponse(BaseModel):
    number: int
    html_url: str
    title: str
    reviewer_warning: str | None = None


class GitHubCollaborator(BaseModel):
    login: str
    avatar_url: str


class GeneratePRDescriptionRequest(BaseModel):
    title: str = Field(max_length=256)
    diff: str = Field(min_length=1, max_length=200_000)
    model_id: str = Field(max_length=128)


class GeneratePRDescriptionResponse(BaseModel):
    description: str


class GenerateCommitMessageRequest(BaseModel):
    diff: str = Field(min_length=1, max_length=200_000)
    model_id: str = Field(max_length=128)


class GenerateCommitMessageResponse(BaseModel):
    message: str
