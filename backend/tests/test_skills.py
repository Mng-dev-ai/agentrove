import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.core.deps import get_skill_service
from app.models.schemas.skills import SkillFileEntry
from app.models.types import CustomSkillDict

from tests.conftest import LoginClient, UserFactory


pytestmark = pytest.mark.anyio


class FakeSkillService:
    def __init__(self) -> None:
        self.updated: list[tuple[str, str, list[SkillFileEntry]]] = []

    def __call__(self) -> "FakeSkillService":
        return self

    def list_all(self) -> list[CustomSkillDict]:
        return [
            {
                "name": "reviewer",
                "description": "Review code changes",
                "size_bytes": 128,
                "file_count": 2,
                "sources": ["codex"],
                "read_only": False,
            }
        ]

    def get_files(self, source: str, skill_name: str) -> list[SkillFileEntry]:
        if skill_name == "missing":
            raise FileNotFoundError("Skill 'missing' not found")

        return [
            SkillFileEntry(
                path="SKILL.md",
                content="---\ndescription: Review code changes\n---\n",
                is_binary=False,
            ),
            SkillFileEntry(path="assets/icon.bin", content="AAE=", is_binary=True),
        ]

    def update(
        self,
        source: str,
        skill_name: str,
        files: list[SkillFileEntry],
    ) -> CustomSkillDict:
        if skill_name == "missing":
            raise FileNotFoundError("Skill 'missing' not found")
        if skill_name == "readonly":
            raise ValueError("Skill 'readonly' is read-only and cannot be edited")

        self.updated.append((source, skill_name, files))
        return {
            "name": skill_name,
            "description": "Updated skill",
            "size_bytes": sum(len(file.content) for file in files),
            "file_count": len(files),
            "sources": [source],
            "read_only": False,
        }


@pytest.fixture(autouse=True)
def fake_skill_service(app: FastAPI) -> FakeSkillService:
    service = FakeSkillService()
    app.dependency_overrides[get_skill_service] = service
    return service


@pytest.fixture
async def auth_headers(
    create_user: UserFactory,
    login: LoginClient,
) -> dict[str, str]:
    await create_user(email="skills@example.com", username="skillsuser")
    tokens = await login(email="skills@example.com")
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def test_list_skills_returns_available_skills(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.get("/api/v1/skills", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == [
        {
            "name": "reviewer",
            "description": "Review code changes",
            "size_bytes": 128,
            "file_count": 2,
            "sources": ["codex"],
            "read_only": False,
        }
    ]


async def test_get_skill_files_returns_text_and_binary_entries(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.get(
        "/api/v1/skills/codex/reviewer/files", headers=auth_headers
    )

    assert response.status_code == 200
    assert response.json() == {
        "name": "reviewer",
        "files": [
            {
                "path": "SKILL.md",
                "content": "---\ndescription: Review code changes\n---\n",
                "is_binary": False,
            },
            {
                "path": "assets/icon.bin",
                "content": "AAE=",
                "is_binary": True,
            },
        ],
    }


async def test_update_skill_passes_files_to_service(
    client: AsyncClient,
    auth_headers: dict[str, str],
    fake_skill_service: FakeSkillService,
) -> None:
    payload = {
        "files": [
            {
                "path": "SKILL.md",
                "content": "---\ndescription: Updated skill\n---\n",
                "is_binary": False,
            }
        ]
    }

    response = await client.put(
        "/api/v1/skills/codex/reviewer",
        json=payload,
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "name": "reviewer",
        "description": "Updated skill",
        "size_bytes": 35,
        "file_count": 1,
        "sources": ["codex"],
        "read_only": False,
    }
    assert len(fake_skill_service.updated) == 1
    source, skill_name, files = fake_skill_service.updated[0]
    assert source == "codex"
    assert skill_name == "reviewer"
    assert files[0].path == "SKILL.md"
    assert files[0].content == "---\ndescription: Updated skill\n---\n"


async def test_skills_translate_service_errors(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    missing_files_response = await client.get(
        "/api/v1/skills/codex/missing/files", headers=auth_headers
    )
    missing_update_response = await client.put(
        "/api/v1/skills/codex/missing",
        json={"files": []},
        headers=auth_headers,
    )
    readonly_response = await client.put(
        "/api/v1/skills/codex/readonly",
        json={"files": []},
        headers=auth_headers,
    )

    assert missing_files_response.status_code == 404
    assert missing_files_response.json()["detail"] == "Skill 'missing' not found"
    assert missing_update_response.status_code == 404
    assert missing_update_response.json()["detail"] == "Skill 'missing' not found"
    assert readonly_response.status_code == 400
    assert readonly_response.json()["detail"] == (
        "Skill 'readonly' is read-only and cannot be edited"
    )


async def test_skills_reject_missing_token(
    client: AsyncClient,
) -> None:
    list_response = await client.get("/api/v1/skills")
    files_response = await client.get("/api/v1/skills/codex/reviewer/files")
    update_response = await client.put(
        "/api/v1/skills/codex/reviewer",
        json={"files": []},
    )

    assert list_response.status_code == 401
    assert files_response.status_code == 401
    assert update_response.status_code == 401
