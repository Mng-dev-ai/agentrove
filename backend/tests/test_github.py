from collections.abc import Callable

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_agent_service
from app.models.db_models.user import User
from app.services.exceptions import AgentException

from tests.conftest import LoginClient, UserFactory
from tests.helpers import get_user_settings


pytestmark = pytest.mark.anyio


TEST_MODEL_ID = "opencode:google-vertex/claude-sonnet-4-6@default"
GITHUB_PAT = "ghp_scripted_token"
DIFF = "diff --git a/app.py b/app.py"


class FakeAgentService:
    # The agent service fronts an external LLM CLI; faking it here keeps these
    # tests on the route contract without spawning an ACP subprocess.
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
    transport_handler: Callable[[httpx.Request], httpx.Response] | None = None

    def __init__(self, *args: object, **kwargs: object) -> None:
        if ScriptedAsyncClient.transport_handler is not None:
            kwargs["transport"] = httpx.MockTransport(
                ScriptedAsyncClient.transport_handler
            )
        super().__init__(*args, **kwargs)


@pytest.fixture
def github(monkeypatch: pytest.MonkeyPatch) -> GitHubTransport:
    # GitHubService instantiates httpx.AsyncClient() itself, so route every
    # instantiation through the scripted transport for the test's duration.
    transport = GitHubTransport()
    monkeypatch.setattr(ScriptedAsyncClient, "transport_handler", transport.handler)
    monkeypatch.setattr(httpx, "AsyncClient", ScriptedAsyncClient)
    return transport


@pytest.fixture
async def auth_headers(
    create_user: UserFactory,
    login: LoginClient,
) -> dict[str, str]:
    await create_user(email="github-user@example.com", username="githubuser")
    tokens = await login(email="github-user@example.com")
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture
async def pat_headers(
    db_session: AsyncSession,
    create_user: UserFactory,
    login: LoginClient,
) -> dict[str, str]:
    user = await create_user(email="github-pat@example.com", username="githubpat")
    tokens = await login(email="github-pat@example.com")
    settings = await get_user_settings(db_session, user.id)
    assert settings is not None
    settings.github_personal_access_token = GITHUB_PAT
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
        "head": {
            "ref": "feature",
            "sha": "abc123",
            "repo": {"full_name": "owner/agentrove"},
        },
        "base": {"ref": "main"},
        "user": {"login": "octocat", "avatar_url": "https://example.com/a.png"},
        "draft": False,
        "review_comments": 1,
    }
    payload.update(overrides)
    return payload


def created_pr_response(number: int) -> httpx.Response:
    return httpx.Response(
        201,
        json={
            "number": number,
            "html_url": f"https://github.com/owner/agentrove/pull/{number}",
            "title": "Ship tests",
        },
    )


async def create_pull_request(
    client: AsyncClient,
    headers: dict[str, str],
    reviewers: list[str] | None = None,
) -> httpx.Response:
    payload: dict[str, object] = {
        "owner": "owner",
        "repo": "agentrove",
        "title": "Ship tests",
        "body": "Adds coverage",
        "head": "feature",
        "base": "main",
    }
    if reviewers is not None:
        payload["reviewers"] = reviewers
    return await client.post("/api/v1/github/pulls", json=payload, headers=headers)


async def test_github_generation_routes_return_agent_output(
    app: FastAPI,
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    agent = FakeAgentService()
    app.dependency_overrides[get_agent_service] = agent

    pr_response = await client.post(
        "/api/v1/github/generate-pr-description",
        json={"title": "Add tests", "diff": DIFF, "model_id": TEST_MODEL_ID},
        headers=auth_headers,
    )
    commit_response = await client.post(
        "/api/v1/github/generate-commit-message",
        json={"diff": DIFF, "model_id": TEST_MODEL_ID},
        headers=auth_headers,
    )

    assert pr_response.status_code == 200
    assert pr_response.json() == {"description": "Generated PR description"}
    assert agent.pr_description_calls[0][:3] == ("Add tests", DIFF, TEST_MODEL_ID)
    assert commit_response.status_code == 200
    assert commit_response.json() == {"message": "Generated commit message"}
    assert agent.commit_message_calls[0][:2] == (DIFF, TEST_MODEL_ID)


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/v1/github/generate-pr-description",
            {"title": "Add tests", "diff": DIFF, "model_id": TEST_MODEL_ID},
        ),
        (
            "/api/v1/github/generate-commit-message",
            {"diff": DIFF, "model_id": TEST_MODEL_ID},
        ),
    ],
)
async def test_github_generation_routes_translate_agent_errors(
    app: FastAPI,
    client: AsyncClient,
    auth_headers: dict[str, str],
    path: str,
    payload: dict[str, str],
) -> None:
    agent = FakeAgentService()
    agent.error = AgentException("Model unavailable", status_code=503)
    app.dependency_overrides[get_agent_service] = agent

    response = await client.post(path, json=payload, headers=auth_headers)

    assert response.status_code == 503
    assert response.json()["detail"] == "Model unavailable"


async def test_github_routes_reject_missing_token(client: AsyncClient) -> None:
    repos_response = await client.get("/api/v1/github/repositories")
    create_pr_response = await create_pull_request(client, {})
    generate_response = await client.post(
        "/api/v1/github/generate-commit-message",
        json={"diff": DIFF, "model_id": TEST_MODEL_ID},
    )

    assert repos_response.status_code == 401
    assert create_pr_response.status_code == 401
    assert generate_response.status_code == 401


async def test_github_routes_reject_user_without_pat(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.get("/api/v1/github/repositories", headers=auth_headers)

    assert response.status_code == 400
    assert response.json()["detail"] == "GitHub personal access token not configured"


async def test_github_lists_repositories_with_search_query(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
) -> None:
    github.script(
        "GET",
        "/search/repositories",
        httpx.Response(200, json={"items": [github_repo_payload()]}),
    )

    response = await client.get(
        "/api/v1/github/repositories?q=agent&page=2&per_page=1",
        headers=pat_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["full_name"] == "owner/app"
    assert body["has_more"] is True
    request = github.requests[0]
    params = dict(request.url.params)
    assert params["q"] == "agent"
    assert params["page"] == "2"
    assert request.headers["authorization"] == f"Bearer {GITHUB_PAT}"


async def test_github_lists_own_repositories_without_query(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
) -> None:
    github.script(
        "GET",
        "/user/repos",
        httpx.Response(
            200, json=[github_repo_payload(name="app2", full_name="owner/app2")]
        ),
    )

    response = await client.get("/api/v1/github/repositories", headers=pat_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["full_name"] == "owner/app2"
    assert body["has_more"] is False
    params = dict(github.requests[0].url.params)
    assert params["affiliation"] == "owner,collaborator,organization_member"


async def test_github_lists_repositories_translates_upstream_error(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
) -> None:
    github.script("GET", "/user/repos", httpx.Response(500, text="upstream failure"))

    response = await client.get("/api/v1/github/repositories", headers=pat_headers)

    assert response.status_code == 502
    assert response.json()["detail"] == "GitHub API request failed"


@pytest.mark.parametrize(
    ("method", "github_path", "route"),
    [
        ("GET", "/user/repos", "/api/v1/github/repositories"),
        (
            "GET",
            "/repos/owner/agentrove/pulls",
            "/api/v1/github/pulls?owner=owner&repo=agentrove",
        ),
        ("POST", "/repos/owner/agentrove/pulls", None),
        (
            "GET",
            "/repos/owner/agentrove/collaborators",
            "/api/v1/github/collaborators?owner=owner&repo=agentrove",
        ),
    ],
)
async def test_github_invalid_pat_is_400_not_401(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
    method: str,
    github_path: str,
    route: str | None,
) -> None:
    # A 401 here would make the frontend log the user out of Agentrove.
    github.script(method, github_path, httpx.Response(401, json={}))

    if route is None:
        response = await create_pull_request(client, pat_headers)
    else:
        response = await client.get(route, headers=pat_headers)

    assert response.status_code == 400
    assert response.json()["detail"] == "GitHub token is invalid or expired"


async def test_github_lists_pull_requests_maps_fields(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
) -> None:
    github.script(
        "GET",
        "/repos/owner/agentrove/pulls",
        httpx.Response(
            200,
            json=[
                github_pr_payload(merged_at="2026-01-02T00:00:00Z"),
                github_pr_payload(
                    number=43,
                    head={"ref": "deleted-fork", "sha": "def456", "repo": None},
                ),
            ],
        ),
    )

    response = await client.get(
        "/api/v1/github/pulls?owner=owner&repo=agentrove&head=owner:feature",
        headers=pat_headers,
    )

    assert response.status_code == 200
    items = response.json()["items"]
    assert items[0]["number"] == 42
    assert items[0]["head"]["repo"]["full_name"] == "owner/agentrove"
    assert items[0]["merged"] is True
    assert items[1]["number"] == 43
    assert items[1]["head"]["repo"]["full_name"] == ""
    assert items[1]["merged"] is False
    assert dict(github.requests[0].url.params)["head"] == "owner:feature"


@pytest.mark.parametrize("reviewers", [None, ["reviewer"]])
async def test_github_creates_pull_request(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
    reviewers: list[str] | None,
) -> None:
    github.script("POST", "/repos/owner/agentrove/pulls", created_pr_response(7))
    github.script(
        "POST",
        "/repos/owner/agentrove/pulls/7/requested_reviewers",
        httpx.Response(201, json={}),
    )

    response = await create_pull_request(client, pat_headers, reviewers)

    assert response.status_code == 200
    body = response.json()
    assert body["number"] == 7
    assert body["reviewer_warning"] is None
    assert len(github.requests) == (2 if reviewers else 1)


@pytest.mark.parametrize(
    "reviewer_outcome",
    [
        httpx.Response(422, json={"message": "not a collaborator"}),
        httpx.ConnectError("boom"),
    ],
)
async def test_github_create_pull_request_survives_reviewer_assignment_failure(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
    reviewer_outcome: httpx.Response | Exception,
) -> None:
    # The PR already exists on GitHub at this point, so the request must
    # succeed and only surface a warning.
    github.script("POST", "/repos/owner/agentrove/pulls", created_pr_response(9))
    github.script(
        "POST",
        "/repos/owner/agentrove/pulls/9/requested_reviewers",
        reviewer_outcome,
    )

    response = await create_pull_request(client, pat_headers, ["reviewer"])

    assert response.status_code == 200
    assert response.json()["number"] == 9
    assert response.json()["reviewer_warning"] == "Failed to assign reviewers"


@pytest.mark.parametrize(
    ("upstream", "expected_detail"),
    [
        (
            httpx.Response(422, json={"message": "Validation failed"}),
            "Validation failed",
        ),
        (
            httpx.Response(500, text="Internal Server Error"),
            "Failed to create pull request",
        ),
    ],
)
async def test_github_create_pull_request_translates_upstream_error(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
    upstream: httpx.Response,
    expected_detail: str,
) -> None:
    github.script("POST", "/repos/owner/agentrove/pulls", upstream)

    response = await create_pull_request(client, pat_headers)

    assert response.status_code == 502
    assert response.json()["detail"] == expected_detail


async def test_github_lists_collaborators(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
) -> None:
    github.script(
        "GET",
        "/repos/owner/agentrove/collaborators",
        httpx.Response(
            200, json=[{"login": "reviewer", "avatar_url": "https://example.com/r"}]
        ),
    )

    response = await client.get(
        "/api/v1/github/collaborators?owner=owner&repo=agentrove", headers=pat_headers
    )

    assert response.status_code == 200
    assert response.json() == [
        {"login": "reviewer", "avatar_url": "https://example.com/r"}
    ]


@pytest.mark.parametrize("status_code", [403, 404])
async def test_github_collaborators_empty_without_push_access(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
    status_code: int,
) -> None:
    # The reviewer picker should go empty, not error, for repos the user
    # can't list collaborators on.
    github.script(
        "GET",
        "/repos/owner/agentrove/collaborators",
        httpx.Response(status_code, json={"message": "nope"}),
    )

    response = await client.get(
        "/api/v1/github/collaborators?owner=owner&repo=agentrove", headers=pat_headers
    )

    assert response.status_code == 200
    assert response.json() == []


async def test_github_collaborators_translates_upstream_error(
    client: AsyncClient,
    pat_headers: dict[str, str],
    github: GitHubTransport,
) -> None:
    github.script(
        "GET",
        "/repos/owner/agentrove/collaborators",
        httpx.Response(500, text="upstream failure"),
    )

    response = await client.get(
        "/api/v1/github/collaborators?owner=owner&repo=agentrove", headers=pat_headers
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Failed to load collaborators"
