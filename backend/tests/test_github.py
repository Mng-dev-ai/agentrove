from collections.abc import Callable

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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
from tests.helpers import get_user_settings


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


class GitHubTransport:
    # Scripted HTTP boundary for app.services.github.GitHubService, keyed by
    # (method, path) so the real service's httpx calls run unmocked end to end.
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self._responses: dict[tuple[str, str], httpx.Response | Exception] = {}

    def script(
        self, method: str, path: str, response: httpx.Response | Exception
    ) -> None:
        self._responses[(method, path)] = response

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        outcome = self._responses[(request.method, request.url.path)]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class ScriptedAsyncClient(httpx.AsyncClient):
    # Handler is set per-test by install_github_transport rather than captured
    # in a closure, so this class stays a plain module-level definition.
    transport_handler: Callable[[httpx.Request], httpx.Response] | None = None

    def __init__(self, *args: object, **kwargs: object) -> None:
        if ScriptedAsyncClient.transport_handler is not None:
            kwargs["transport"] = httpx.MockTransport(
                ScriptedAsyncClient.transport_handler
            )
        super().__init__(*args, **kwargs)


def install_github_transport(
    monkeypatch: pytest.MonkeyPatch, transport: GitHubTransport
) -> None:
    # GitHubService instantiates httpx.AsyncClient() itself, so route every
    # instantiation through our scripted transport for the test's duration.
    monkeypatch.setattr(ScriptedAsyncClient, "transport_handler", transport.handler)
    monkeypatch.setattr(httpx, "AsyncClient", ScriptedAsyncClient)


async def create_headers_with_github_pat(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    *,
    email: str,
    username: str,
    token: str = "ghp_scripted_token",
) -> dict[str, str]:
    user = await create_user(email=email, username=username)
    tokens = await login(email=email)
    settings = await get_user_settings(db_session, user.id)
    assert settings is not None
    settings.github_personal_access_token = token
    await db_session.commit()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def github_repo_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": "app",
        "full_name": "owner/app",
        "description": "desc",
        "language": "Python",
        "html_url": "https://github.com/owner/app",
        "clone_url": "https://github.com/owner/app.git",
        "private": False,
        "pushed_at": "2026-01-01T00:00:00Z",
        "stargazers_count": 3,
    }
    payload.update(overrides)
    return payload


def github_pr_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "number": 42,
        "title": "Add feature",
        "body": "Details",
        "state": "open",
        "html_url": "https://github.com/owner/agentrove/pull/42",
        "head": {"ref": "feature", "repo": {"full_name": "owner/agentrove"}},
        "base": {"ref": "main"},
        "user": {"login": "octocat", "avatar_url": "https://example.com/a.png"},
        "draft": False,
        "review_comments": 1,
    }
    payload.update(overrides)
    return payload


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


async def test_github_generate_pr_description_translates_agent_errors(
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
        "/api/v1/github/generate-pr-description",
        json={
            "title": "Add tests",
            "diff": "diff --git a/app.py b/app.py",
            "model_id": TEST_MODEL_ID,
        },
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


async def test_github_service_lists_repositories_with_search_query(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-search@example.com",
        username="ghsearch",
        token="ghp_search_token",
    )
    transport = GitHubTransport()
    transport.script(
        "GET",
        "/search/repositories",
        httpx.Response(200, json={"items": [github_repo_payload()]}),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.get(
        "/api/v1/github/repositories?q=agent&page=2&per_page=1",
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["full_name"] == "owner/app"
    assert body["has_more"] is True
    request = transport.requests[0]
    params = dict(request.url.params)
    assert params["q"] == "agent"
    assert params["page"] == "2"
    assert request.headers["authorization"] == "Bearer ghp_search_token"


async def test_github_service_lists_repositories_default_via_user_repos(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-default@example.com",
        username="ghdefault",
    )
    transport = GitHubTransport()
    transport.script(
        "GET",
        "/user/repos",
        httpx.Response(
            200, json=[github_repo_payload(name="app2", full_name="owner/app2")]
        ),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.get("/api/v1/github/repositories", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["full_name"] == "owner/app2"
    assert body["has_more"] is False
    params = dict(transport.requests[0].url.params)
    assert params["affiliation"] == "owner,collaborator,organization_member"


async def test_github_service_lists_repositories_translates_generic_error(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-error@example.com",
        username="gherror",
    )
    transport = GitHubTransport()
    transport.script("GET", "/user/repos", httpx.Response(500, text="upstream failure"))
    install_github_transport(monkeypatch, transport)

    response = await client.get("/api/v1/github/repositories", headers=headers)

    assert response.status_code == 502
    assert response.json()["detail"] == "GitHub API request failed"


async def test_github_service_lists_pull_requests_maps_fields(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-prs@example.com",
        username="ghprs",
    )
    transport = GitHubTransport()
    transport.script(
        "GET",
        "/repos/owner/agentrove/pulls",
        httpx.Response(
            200,
            json=[
                github_pr_payload(),
                github_pr_payload(
                    number=43,
                    head={"ref": "deleted-fork", "repo": None},
                ),
            ],
        ),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.get(
        "/api/v1/github/pulls?owner=owner&repo=agentrove", headers=headers
    )

    assert response.status_code == 200
    items = response.json()["items"]
    assert items[0]["number"] == 42
    assert items[0]["head"]["repo"]["full_name"] == "owner/agentrove"
    assert items[1]["number"] == 43
    assert items[1]["head"]["repo"]["full_name"] == ""


async def test_github_service_lists_pull_requests_translates_invalid_token(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-badtoken@example.com",
        username="ghbadtoken",
    )
    transport = GitHubTransport()
    transport.script(
        "GET", "/repos/owner/agentrove/pulls", httpx.Response(401, json={})
    )
    install_github_transport(monkeypatch, transport)

    response = await client.get(
        "/api/v1/github/pulls?owner=owner&repo=agentrove", headers=headers
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "GitHub token is invalid or expired"


async def test_github_service_creates_pull_request_without_reviewers(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-create-pr@example.com",
        username="ghcreatepr",
    )
    transport = GitHubTransport()
    transport.script(
        "POST",
        "/repos/owner/agentrove/pulls",
        httpx.Response(
            201,
            json={
                "number": 7,
                "html_url": "https://github.com/owner/agentrove/pull/7",
                "title": "Ship tests",
            },
        ),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.post(
        "/api/v1/github/pulls",
        json={
            "owner": "owner",
            "repo": "agentrove",
            "title": "Ship tests",
            "body": "Adds coverage",
            "head": "feature",
            "base": "main",
        },
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["number"] == 7
    assert body["reviewer_warning"] is None
    assert len(transport.requests) == 1


async def test_github_service_creates_pull_request_assigns_reviewers(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-reviewers-ok@example.com",
        username="ghreviewersok",
    )
    transport = GitHubTransport()
    transport.script(
        "POST",
        "/repos/owner/agentrove/pulls",
        httpx.Response(
            201,
            json={
                "number": 8,
                "html_url": "https://github.com/owner/agentrove/pull/8",
                "title": "Ship tests",
            },
        ),
    )
    transport.script(
        "POST",
        "/repos/owner/agentrove/pulls/8/requested_reviewers",
        httpx.Response(201, json={}),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.post(
        "/api/v1/github/pulls",
        json={
            "owner": "owner",
            "repo": "agentrove",
            "title": "Ship tests",
            "body": "Adds coverage",
            "head": "feature",
            "base": "main",
            "reviewers": ["reviewer"],
        },
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["reviewer_warning"] is None
    assert len(transport.requests) == 2


async def test_github_service_creates_pull_request_reviewer_failure_sets_warning(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-reviewers-fail@example.com",
        username="ghreviewersfail",
    )
    transport = GitHubTransport()
    transport.script(
        "POST",
        "/repos/owner/agentrove/pulls",
        httpx.Response(
            201,
            json={
                "number": 9,
                "html_url": "https://github.com/owner/agentrove/pull/9",
                "title": "Ship tests",
            },
        ),
    )
    transport.script(
        "POST",
        "/repos/owner/agentrove/pulls/9/requested_reviewers",
        httpx.Response(422, json={"message": "not a collaborator"}),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.post(
        "/api/v1/github/pulls",
        json={
            "owner": "owner",
            "repo": "agentrove",
            "title": "Ship tests",
            "body": "Adds coverage",
            "head": "feature",
            "base": "main",
            "reviewers": ["reviewer"],
        },
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["reviewer_warning"] == "Failed to assign reviewers"


async def test_github_service_creates_pull_request_reviewer_network_error_sets_warning(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-reviewers-network@example.com",
        username="ghreviewersnetwork",
    )
    transport = GitHubTransport()
    transport.script(
        "POST",
        "/repos/owner/agentrove/pulls",
        httpx.Response(
            201,
            json={
                "number": 10,
                "html_url": "https://github.com/owner/agentrove/pull/10",
                "title": "Ship tests",
            },
        ),
    )
    transport.script(
        "POST",
        "/repos/owner/agentrove/pulls/10/requested_reviewers",
        httpx.ConnectError("boom"),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.post(
        "/api/v1/github/pulls",
        json={
            "owner": "owner",
            "repo": "agentrove",
            "title": "Ship tests",
            "body": "Adds coverage",
            "head": "feature",
            "base": "main",
            "reviewers": ["reviewer"],
        },
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["reviewer_warning"] == "Failed to assign reviewers"


async def test_github_service_creates_pull_request_translates_json_error_message(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-create-fail-json@example.com",
        username="ghcreatefailjson",
    )
    transport = GitHubTransport()
    transport.script(
        "POST",
        "/repos/owner/agentrove/pulls",
        httpx.Response(422, json={"message": "Validation failed"}),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.post(
        "/api/v1/github/pulls",
        json={
            "owner": "owner",
            "repo": "agentrove",
            "title": "Ship tests",
            "body": "Adds coverage",
            "head": "feature",
            "base": "main",
        },
        headers=headers,
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Validation failed"


async def test_github_service_creates_pull_request_translates_non_json_error_body(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-create-fail-text@example.com",
        username="ghcreatefailtext",
    )
    transport = GitHubTransport()
    transport.script(
        "POST",
        "/repos/owner/agentrove/pulls",
        httpx.Response(500, text="Internal Server Error"),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.post(
        "/api/v1/github/pulls",
        json={
            "owner": "owner",
            "repo": "agentrove",
            "title": "Ship tests",
            "body": "Adds coverage",
            "head": "feature",
            "base": "main",
        },
        headers=headers,
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Failed to create pull request"


async def test_github_service_creates_pull_request_translates_invalid_token(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-create-badtoken@example.com",
        username="ghcreatebadtoken",
    )
    transport = GitHubTransport()
    transport.script(
        "POST", "/repos/owner/agentrove/pulls", httpx.Response(401, json={})
    )
    install_github_transport(monkeypatch, transport)

    response = await client.post(
        "/api/v1/github/pulls",
        json={
            "owner": "owner",
            "repo": "agentrove",
            "title": "Ship tests",
            "body": "Adds coverage",
            "head": "feature",
            "base": "main",
        },
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "GitHub token is invalid or expired"


async def test_github_service_lists_collaborators_returns_data(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-collaborators@example.com",
        username="ghcollaborators",
    )
    transport = GitHubTransport()
    transport.script(
        "GET",
        "/repos/owner/agentrove/collaborators",
        httpx.Response(
            200, json=[{"login": "reviewer", "avatar_url": "https://example.com/r"}]
        ),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.get(
        "/api/v1/github/collaborators?owner=owner&repo=agentrove", headers=headers
    )

    assert response.status_code == 200
    assert response.json() == [
        {"login": "reviewer", "avatar_url": "https://example.com/r"}
    ]


async def test_github_service_collaborators_returns_empty_when_forbidden(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-collaborators-403@example.com",
        username="ghcollaborators403",
    )
    transport = GitHubTransport()
    transport.script(
        "GET",
        "/repos/owner/agentrove/collaborators",
        httpx.Response(403, json={"message": "Forbidden"}),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.get(
        "/api/v1/github/collaborators?owner=owner&repo=agentrove", headers=headers
    )

    assert response.status_code == 200
    assert response.json() == []


async def test_github_service_lists_collaborators_translates_generic_error(
    client: AsyncClient,
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await create_headers_with_github_pat(
        db_session,
        create_user,
        login,
        email="gh-collaborators-error@example.com",
        username="ghcollaboratorserror",
    )
    transport = GitHubTransport()
    transport.script(
        "GET",
        "/repos/owner/agentrove/collaborators",
        httpx.Response(500, text="upstream failure"),
    )
    install_github_transport(monkeypatch, transport)

    response = await client.get(
        "/api/v1/github/collaborators?owner=owner&repo=agentrove", headers=headers
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Failed to load collaborators"
