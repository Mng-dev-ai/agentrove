import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.core.deps import get_agent_service, get_github_service
from app.models.db_models.user import User
from app.models.schemas.github import (
    CreatePullRequestRequest,
    CreatePullRequestResponse,
    GitHubCollaborator,
    GitHubPRListResponse,
    GitHubPullRequest,
    GitHubRepo,
    GitHubReposResponse,
)
from app.services.exceptions import AgentException, GitHubException

from tests.conftest import LoginClient, UserFactory


pytestmark = pytest.mark.anyio


TEST_MODEL_ID = "opencode:google-vertex-anthropic/claude-sonnet-4-5@20250929"


class FakeGitHubService:
    def __init__(self) -> None:
        self.repo_calls: list[tuple[str, int, int]] = []
        self.pr_calls: list[tuple[str, str]] = []
        self.create_pr_requests: list[CreatePullRequestRequest] = []
        self.collaborator_calls: list[tuple[str, str]] = []
        self.error: GitHubException | None = None

    def __call__(self) -> "FakeGitHubService":
        return self

    async def list_repositories(
        self, query: str, page: int, per_page: int
    ) -> GitHubReposResponse:
        if self.error:
            raise self.error
        self.repo_calls.append((query, page, per_page))
        return GitHubReposResponse(
            items=[
                GitHubRepo(
                    name="agentrove",
                    full_name="owner/agentrove",
                    description="Self-hosted agents",
                    language="Python",
                    html_url="https://github.com/owner/agentrove",
                    clone_url="https://github.com/owner/agentrove.git",
                    private=False,
                    pushed_at="2026-01-01T00:00:00Z",
                    stargazers_count=7,
                )
            ],
            has_more=False,
        )

    async def list_pull_requests(self, owner: str, repo: str) -> GitHubPRListResponse:
        if self.error:
            raise self.error
        self.pr_calls.append((owner, repo))
        return GitHubPRListResponse(
            items=[
                GitHubPullRequest(
                    number=12,
                    title="Improve tests",
                    body="Adds coverage",
                    state="open",
                    html_url="https://github.com/owner/agentrove/pull/12",
                    head={"ref": "feature", "repo": {"full_name": "owner/agentrove"}},
                    base={"ref": "main"},
                    user={
                        "login": "octocat",
                        "avatar_url": "https://example.com/a.png",
                    },
                    draft=False,
                    review_comments=2,
                )
            ]
        )

    async def create_pull_request(
        self, request: CreatePullRequestRequest
    ) -> CreatePullRequestResponse:
        if self.error:
            raise self.error
        self.create_pr_requests.append(request)
        return CreatePullRequestResponse(
            number=13,
            html_url="https://github.com/owner/agentrove/pull/13",
            title=request.title,
            reviewer_warning=None,
        )

    async def list_collaborators(
        self, owner: str, repo: str
    ) -> list[GitHubCollaborator]:
        if self.error:
            raise self.error
        self.collaborator_calls.append((owner, repo))
        return [GitHubCollaborator(login="reviewer", avatar_url="")]


class FakeAgentService:
    def __init__(self) -> None:
        self.pr_description_calls: list[tuple[str, str, str, User]] = []
        self.commit_message_calls: list[tuple[str, str, User]] = []
        self.error: AgentException | None = None

    def __call__(self) -> "FakeAgentService":
        return self

    async def generate_pr_description(
        self, title: str, diff: str, model_id: str, user: User
    ) -> str:
        if self.error:
            raise self.error
        self.pr_description_calls.append((title, diff, model_id, user))
        return "Generated PR description"

    async def generate_commit_message(
        self, diff: str, model_id: str, user: User
    ) -> str:
        if self.error:
            raise self.error
        self.commit_message_calls.append((diff, model_id, user))
        return "Generated commit message"


async def create_auth_headers(
    create_user: UserFactory,
    login: LoginClient,
) -> dict[str, str]:
    await create_user(email="github-user@example.com", username="githubuser")
    tokens = await login(email="github-user@example.com")
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def test_github_service_routes_call_dependency(
    app: FastAPI,
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    github = FakeGitHubService()
    app.dependency_overrides[get_github_service] = github
    headers = await create_auth_headers(create_user, login)

    repos_response = await client.get(
        "/api/v1/github/repositories?q=agent&page=2&per_page=5",
        headers=headers,
    )
    prs_response = await client.get(
        "/api/v1/github/pulls?owner=owner&repo=agentrove",
        headers=headers,
    )
    create_pr_response = await client.post(
        "/api/v1/github/pulls",
        json={
            "owner": "owner",
            "repo": "agentrove",
            "title": "Ship tests",
            "body": "Adds endpoint coverage",
            "head": "feature",
            "base": "main",
            "reviewers": ["reviewer"],
        },
        headers=headers,
    )
    collaborators_response = await client.get(
        "/api/v1/github/collaborators?owner=owner&repo=agentrove",
        headers=headers,
    )

    assert repos_response.status_code == 200
    assert repos_response.json()["items"][0]["full_name"] == "owner/agentrove"
    assert github.repo_calls == [("agent", 2, 5)]
    assert prs_response.status_code == 200
    assert prs_response.json()["items"][0]["number"] == 12
    assert github.pr_calls == [("owner", "agentrove")]
    assert create_pr_response.status_code == 200
    assert create_pr_response.json()["number"] == 13
    assert github.create_pr_requests[0].reviewers == ["reviewer"]
    assert collaborators_response.status_code == 200
    assert collaborators_response.json() == [{"login": "reviewer", "avatar_url": ""}]
    assert github.collaborator_calls == [("owner", "agentrove")]


async def test_github_routes_translate_service_errors(
    app: FastAPI,
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    github = FakeGitHubService()
    github.error = GitHubException("GitHub unavailable", status_code=503)
    app.dependency_overrides[get_github_service] = github
    headers = await create_auth_headers(create_user, login)

    response = await client.get("/api/v1/github/repositories", headers=headers)

    assert response.status_code == 503
    assert response.json()["detail"] == "GitHub unavailable"


async def test_github_generation_routes_call_agent_service(
    app: FastAPI,
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    agent = FakeAgentService()
    app.dependency_overrides[get_agent_service] = agent
    headers = await create_auth_headers(create_user, login)

    pr_response = await client.post(
        "/api/v1/github/generate-pr-description",
        json={
            "title": "Add tests",
            "diff": "diff --git a/app.py b/app.py",
            "model_id": TEST_MODEL_ID,
        },
        headers=headers,
    )
    commit_response = await client.post(
        "/api/v1/github/generate-commit-message",
        json={"diff": "diff --git a/app.py b/app.py", "model_id": TEST_MODEL_ID},
        headers=headers,
    )

    assert pr_response.status_code == 200
    assert pr_response.json() == {"description": "Generated PR description"}
    assert agent.pr_description_calls[0][:3] == (
        "Add tests",
        "diff --git a/app.py b/app.py",
        TEST_MODEL_ID,
    )
    assert commit_response.status_code == 200
    assert commit_response.json() == {"message": "Generated commit message"}
    assert agent.commit_message_calls[0][:2] == (
        "diff --git a/app.py b/app.py",
        TEST_MODEL_ID,
    )


async def test_github_generation_routes_translate_agent_errors(
    app: FastAPI,
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    agent = FakeAgentService()
    agent.error = AgentException("Model unavailable", status_code=503)
    app.dependency_overrides[get_agent_service] = agent
    headers = await create_auth_headers(create_user, login)

    response = await client.post(
        "/api/v1/github/generate-commit-message",
        json={"diff": "diff --git a/app.py b/app.py", "model_id": TEST_MODEL_ID},
        headers=headers,
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Model unavailable"


async def test_github_routes_reject_missing_token(client: AsyncClient) -> None:
    repos_response = await client.get("/api/v1/github/repositories")
    create_pr_response = await client.post(
        "/api/v1/github/pulls",
        json={
            "owner": "owner",
            "repo": "agentrove",
            "title": "No auth",
            "body": "No auth",
            "head": "feature",
            "base": "main",
        },
    )
    generate_response = await client.post(
        "/api/v1/github/generate-commit-message",
        json={"diff": "diff --git a/app.py b/app.py", "model_id": TEST_MODEL_ID},
    )

    assert repos_response.status_code == 401
    assert create_pr_response.status_code == 401
    assert generate_response.status_code == 401


async def test_github_service_routes_reject_authenticated_user_without_pat(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
) -> None:
    headers = await create_auth_headers(create_user, login)

    response = await client.get("/api/v1/github/repositories", headers=headers)

    assert response.status_code == 400
    assert response.json()["detail"] == "GitHub personal access token not configured"
