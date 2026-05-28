import logging

import httpx

from app.models.schemas.github import (
    CreatePullRequestRequest,
    CreatePullRequestResponse,
    GitHubCollaborator,
    GitHubPRListResponse,
    GitHubPullRequest,
    GitHubRepo,
    GitHubReposResponse,
)
from app.services.exceptions import ErrorCode, GitHubException

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


class GitHubService:
    def __init__(self, token: str) -> None:
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _check_auth(self, response: httpx.Response) -> None:
        if response.status_code == 401:
            # Reserve HTTP 401 for this app's own auth/session failures so the frontend
            # does not treat an invalid GitHub PAT as a reason to log the user out.
            raise GitHubException(
                "GitHub token is invalid or expired",
                error_code=ErrorCode.GITHUB_TOKEN_INVALID,
                status_code=400,
            )

    def _check_response(self, response: httpx.Response) -> None:
        self._check_auth(response)
        if response.status_code != 200:
            logger.warning(
                "GitHub API returned %d: %s",
                response.status_code,
                response.text[:200],
            )
            raise GitHubException("GitHub API request failed")

    async def list_repositories(
        self, query: str, page: int, per_page: int
    ) -> GitHubReposResponse:
        stripped = query.strip()
        async with httpx.AsyncClient(timeout=10.0) as client:
            if stripped:
                response = await client.get(
                    f"{GITHUB_API_BASE}/search/repositories",
                    params={
                        "q": stripped,
                        "sort": "updated",
                        "order": "desc",
                        "per_page": per_page,
                        "page": page,
                    },
                    headers=self._headers,
                )
            else:
                response = await client.get(
                    f"{GITHUB_API_BASE}/user/repos",
                    params={
                        "sort": "pushed",
                        "direction": "desc",
                        "per_page": per_page,
                        "page": page,
                        "affiliation": "owner,collaborator,organization_member",
                    },
                    headers=self._headers,
                )

        self._check_response(response)

        data = response.json()
        raw_repos = data.get("items", data) if isinstance(data, dict) else data

        repos = [
            GitHubRepo(
                name=r["name"],
                full_name=r["full_name"],
                description=r.get("description"),
                language=r.get("language"),
                html_url=r["html_url"],
                clone_url=r["clone_url"],
                private=r.get("private", False),
                pushed_at=r.get("pushed_at"),
                stargazers_count=r.get("stargazers_count", 0),
            )
            for r in raw_repos
        ]

        return GitHubReposResponse(items=repos, has_more=len(raw_repos) == per_page)

    async def list_pull_requests(self, owner: str, repo: str) -> GitHubPRListResponse:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls",
                params={
                    "state": "open",
                    "per_page": 30,
                    "sort": "updated",
                    "direction": "desc",
                },
                headers=self._headers,
            )

        self._check_response(response)

        raw_prs = response.json()
        prs = [
            GitHubPullRequest(
                number=pr["number"],
                title=pr["title"],
                body=pr.get("body"),
                state=pr["state"],
                html_url=pr["html_url"],
                head={
                    "ref": pr["head"]["ref"],
                    "repo": {
                        "full_name": (
                            pr["head"]["repo"]["full_name"]
                            if pr["head"].get("repo")
                            else ""
                        )
                    },
                },
                base={"ref": pr["base"]["ref"]},
                user={
                    "login": pr["user"]["login"],
                    "avatar_url": pr["user"].get("avatar_url", ""),
                },
                draft=pr.get("draft", False),
                review_comments=pr.get("review_comments", 0),
            )
            for pr in raw_prs
        ]

        return GitHubPRListResponse(items=prs)

    async def create_pull_request(
        self, request: CreatePullRequestRequest
    ) -> CreatePullRequestResponse:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{GITHUB_API_BASE}/repos/{request.owner}/{request.repo}/pulls",
                json={
                    "title": request.title,
                    "body": request.body,
                    "head": request.head,
                    "base": request.base,
                },
                headers=self._headers,
            )

            self._check_auth(response)
            if response.status_code not in (200, 201):
                logger.warning(
                    "GitHub API returned %d: %s",
                    response.status_code,
                    response.text[:200],
                )
                try:
                    detail = response.json().get(
                        "message", "Failed to create pull request"
                    )
                except (ValueError, KeyError):
                    detail = "Failed to create pull request"
                raise GitHubException(detail)

            pr_data = response.json()

            reviewer_warning = None
            if request.reviewers:
                try:
                    reviewer_resp = await client.post(
                        f"{GITHUB_API_BASE}/repos/{request.owner}/{request.repo}/pulls/{pr_data['number']}/requested_reviewers",
                        json={"reviewers": request.reviewers},
                        headers=self._headers,
                    )
                    if reviewer_resp.status_code not in (200, 201):
                        reviewer_warning = "Failed to assign reviewers"
                        logger.warning(
                            "Failed to assign reviewers to PR #%d: %s",
                            pr_data["number"],
                            reviewer_resp.text[:200],
                        )
                except httpx.HTTPError:
                    reviewer_warning = "Failed to assign reviewers"
                    logger.warning(
                        "Failed to assign reviewers to PR #%d", pr_data["number"]
                    )

        return CreatePullRequestResponse(
            number=pr_data["number"],
            html_url=pr_data["html_url"],
            title=pr_data["title"],
            reviewer_warning=reviewer_warning,
        )

    async def list_collaborators(
        self, owner: str, repo: str
    ) -> list[GitHubCollaborator]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}/collaborators",
                params={"per_page": 50},
                headers=self._headers,
            )

        self._check_auth(response)
        # 403/404 are expected when user lacks push access to the repo
        if response.status_code in (403, 404):
            return []
        if response.status_code != 200:
            logger.warning(
                "GitHub collaborators API returned %d: %s",
                response.status_code,
                response.text[:200],
            )
            raise GitHubException("Failed to load collaborators")

        return [
            GitHubCollaborator(login=c["login"], avatar_url=c.get("avatar_url", ""))
            for c in response.json()
        ]
