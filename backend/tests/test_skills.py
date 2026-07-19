import base64
import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.deps import get_skill_service
from app.models.schemas.skills import SkillFileEntry
from app.models.types import CustomSkillDict
from app.services.sandbox_providers.base import SandboxProvider

from tests.conftest import LoginClient, UserFactory
from tests.helpers import FakeProviderFactory


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


@pytest.fixture
def real_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(SandboxProvider, "create_provider", FakeProviderFactory())


@pytest.fixture
def real_skill_service(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    # The autouse fake_skill_service fixture above overrides get_skill_service
    # for every test in this module. Real SkillService also branches on
    # DESKTOP_MODE — force server mode so the global skill dir resolves under
    # STORAGE_PATH regardless of DESKTOP_MODE leaking from the host shell env.
    monkeypatch.setattr(get_settings(), "DESKTOP_MODE", False)
    del app.dependency_overrides[get_skill_service]


async def create_real_workspace(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    *,
    email: str,
    username: str,
) -> tuple[dict[str, str], str, str]:
    await create_user(email=email, username=username)
    tokens = await login(email=email)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    response = await client.post(
        "/api/v1/workspaces",
        json={
            "name": "Skill Workspace",
            "source_type": "empty",
            "sandbox_provider": "host",
        },
        headers=headers,
    )
    assert response.status_code == 201
    body = response.json()
    return headers, body["id"], body["workspace_path"]


def agent_home_for(workspace_path: str) -> Path:
    # Workspaces live under STORAGE_PATH/workspaces/<user_id>/..., so the
    # owner's id — which keys the per-user agent home — is the parent dir name.
    return Path(get_settings().get_agent_home_dir(Path(workspace_path).parent.name))


def write_skill_md(skill_dir: Path, description: str, body: str = "Body text") -> None:
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\ndescription: {description}\n---\n{body}\n", encoding="utf-8"
    )


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


async def test_real_skill_service_lists_reads_and_updates_files_on_disk(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
) -> None:
    headers, workspace_id, workspace_path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill@example.com",
        username="realskill",
    )
    skill_dir = Path(workspace_path) / ".claude" / "skills" / "myskill"
    write_skill_md(skill_dir, "Reviews code changes")
    (skill_dir / "reference.md").write_text("See also", encoding="utf-8")
    png_bytes = b"\x89PNG\r\n\x1a\n" + bytes(range(10))
    (skill_dir / "assets").mkdir()
    (skill_dir / "assets" / "logo.png").write_bytes(png_bytes)

    list_response = await client.get(
        "/api/v1/skills", params={"workspace_id": workspace_id}, headers=headers
    )
    files_response = await client.get(
        "/api/v1/skills/claude/myskill/files",
        params={"workspace_id": workspace_id},
        headers=headers,
    )

    assert list_response.status_code == 200
    entries = {item["name"]: item for item in list_response.json()}
    assert entries["myskill"]["description"] == "Reviews code changes"
    # Grok and OpenCode also cross-read `.claude/skills`, so the same on-disk
    # dir surfaces under all three sources (see SkillService._build_paths_by_source).
    assert entries["myskill"]["sources"] == ["claude", "grok", "opencode"]
    assert entries["myskill"]["read_only"] is False
    assert entries["myskill"]["file_count"] == 3

    assert files_response.status_code == 200
    files_by_path = {f["path"]: f for f in files_response.json()["files"]}
    assert files_by_path["SKILL.md"]["is_binary"] is False
    assert "Reviews code changes" in files_by_path["SKILL.md"]["content"]
    logo_entry = files_by_path["assets/logo.png"]
    assert logo_entry["is_binary"] is True
    assert base64.b64decode(logo_entry["content"]) == png_bytes

    update_response = await client.put(
        "/api/v1/skills/claude/myskill",
        json={
            "files": [
                {
                    "path": "SKILL.md",
                    "content": "---\ndescription: Updated description\n---\nNew body\n",
                    "is_binary": False,
                }
            ]
        },
        params={"workspace_id": workspace_id},
        headers=headers,
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["description"] == "Updated description"
    assert updated["file_count"] == 1
    assert updated["sources"] == ["claude"]
    # update() replaces the whole skill dir, so files not resubmitted are gone.
    assert not (skill_dir / "reference.md").exists()
    assert not (skill_dir / "assets").exists()
    assert "Updated description" in (skill_dir / "SKILL.md").read_text(encoding="utf-8")


async def test_real_skill_service_skips_dangling_symlinks_and_binary_frontmatter(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
) -> None:
    headers, workspace_id, workspace_path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-edge@example.com",
        username="realskilledge",
    )
    skills_root = Path(workspace_path) / ".claude" / "skills"
    good_skill = skills_root / "goodskill"
    write_skill_md(good_skill, "Good skill")
    # A dangling symlink makes Path.stat() raise FileNotFoundError (an OSError
    # subclass) during _compute_dir_stats's rglob walk — must be skipped, not raised.
    os.symlink(good_skill / "missing-target", good_skill / "broken-link")

    unreadable_skill = skills_root / "unreadableskill"
    unreadable_skill.mkdir(parents=True)
    # Invalid UTF-8 bytes make SKILL.md unreadable as text — list_all should
    # skip the skill instead of raising UnicodeDecodeError.
    (unreadable_skill / "SKILL.md").write_bytes(b"---\ndescription: \xff\xfe\n---\n")

    response = await client.get(
        "/api/v1/skills", params={"workspace_id": workspace_id}, headers=headers
    )

    assert response.status_code == 200
    names = {item["name"] for item in response.json()}
    assert "goodskill" in names
    assert "unreadableskill" not in names


async def test_real_skill_service_returns_404_for_unknown_skill(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
) -> None:
    headers, workspace_id, _path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-missing@example.com",
        username="realskillmissing",
    )

    files_response = await client.get(
        "/api/v1/skills/claude/does-not-exist/files",
        params={"workspace_id": workspace_id},
        headers=headers,
    )
    update_response = await client.put(
        "/api/v1/skills/claude/does-not-exist",
        json={"files": []},
        params={"workspace_id": workspace_id},
        headers=headers,
    )

    assert files_response.status_code == 404
    assert files_response.json()["detail"] == "Skill 'does-not-exist' not found"
    assert update_response.status_code == 404
    assert update_response.json()["detail"] == "Skill 'does-not-exist' not found"


async def test_real_skill_service_rejects_readonly_cursor_builtin_update(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
) -> None:
    headers, workspace_id, workspace_path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-readonly@example.com",
        username="realskillro",
    )
    skill_name = f"builtin-{uuid4().hex[:8]}"
    builtin_dir = (
        agent_home_for(workspace_path) / ".cursor" / "skills-cursor" / skill_name
    )
    write_skill_md(builtin_dir, "Cursor built-in skill")

    response = await client.put(
        f"/api/v1/skills/cursor/{skill_name}",
        json={
            "files": [
                {
                    "path": "SKILL.md",
                    "content": "---\ndescription: Hijacked\n---\nBody\n",
                    "is_binary": False,
                }
            ]
        },
        params={"workspace_id": workspace_id},
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        f"Skill '{skill_name}' is read-only and cannot be edited"
    )


async def test_real_skill_service_update_rejects_path_traversal(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
) -> None:
    headers, workspace_id, workspace_path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-traversal@example.com",
        username="realskilltraversal",
    )
    skill_dir = Path(workspace_path) / ".claude" / "skills" / "traversal"
    write_skill_md(skill_dir, "Traversal target")

    response = await client.put(
        "/api/v1/skills/claude/traversal",
        json={
            "files": [{"path": "../escaped.txt", "content": "x", "is_binary": False}]
        },
        params={"workspace_id": workspace_id},
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid file path: ../escaped.txt"


async def test_real_skill_service_update_writes_binary_files(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
) -> None:
    headers, workspace_id, workspace_path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-binary@example.com",
        username="realskillbinary",
    )
    skill_dir = Path(workspace_path) / ".claude" / "skills" / "binaryskill"
    write_skill_md(skill_dir, "Binary asset skill")
    payload_bytes = b"\x00\x01binary-content"

    response = await client.put(
        "/api/v1/skills/claude/binaryskill",
        json={
            "files": [
                {
                    "path": "SKILL.md",
                    "content": "---\ndescription: Binary asset skill\n---\nBody\n",
                    "is_binary": False,
                },
                {
                    "path": "assets/data.bin",
                    "content": base64.b64encode(payload_bytes).decode("ascii"),
                    "is_binary": True,
                },
            ]
        },
        params={"workspace_id": workspace_id},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["file_count"] == 2
    assert (skill_dir / "assets" / "data.bin").read_bytes() == payload_bytes


async def test_real_skill_service_update_rejects_invalid_frontmatter(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
) -> None:
    headers, workspace_id, workspace_path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-badyaml@example.com",
        username="realskillbadyaml",
    )
    skill_dir = Path(workspace_path) / ".claude" / "skills" / "badyaml"
    write_skill_md(skill_dir, "Bad yaml target")

    no_frontmatter_response = await client.put(
        "/api/v1/skills/claude/badyaml",
        json={
            "files": [
                {
                    "path": "SKILL.md",
                    "content": "No frontmatter here",
                    "is_binary": False,
                }
            ]
        },
        params={"workspace_id": workspace_id},
        headers=headers,
    )
    unterminated_response = await client.put(
        "/api/v1/skills/claude/badyaml",
        json={
            "files": [
                {
                    "path": "SKILL.md",
                    "content": "---\ndescription: no closing marker\n",
                    "is_binary": False,
                }
            ]
        },
        params={"workspace_id": workspace_id},
        headers=headers,
    )
    non_dict_response = await client.put(
        "/api/v1/skills/claude/badyaml",
        json={
            "files": [
                {
                    "path": "SKILL.md",
                    "content": "---\njust a plain string\n---\nBody\n",
                    "is_binary": False,
                }
            ]
        },
        params={"workspace_id": workspace_id},
        headers=headers,
    )

    assert no_frontmatter_response.status_code == 400
    assert no_frontmatter_response.json()["detail"] == (
        "Content must start with YAML frontmatter (---)"
    )
    assert unterminated_response.status_code == 400
    assert unterminated_response.json()["detail"] == (
        "YAML frontmatter must end with ---"
    )
    assert non_dict_response.status_code == 400
    assert non_dict_response.json()["detail"] == (
        "YAML frontmatter must be a dictionary"
    )


async def test_real_skill_service_discovers_enabled_claude_plugin_skills(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Server mode resolves the plugin config under the owner's agent home —
    # isolate under the per-test tmp dir, and create the workspace first since
    # the agent home is keyed by the owner's user id.
    monkeypatch.setattr(get_settings(), "STORAGE_PATH", str(tmp_path))
    headers, workspace_id, workspace_path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-plugin@example.com",
        username="realskillplugin",
    )
    claude_dir = agent_home_for(workspace_path) / ".claude"
    claude_dir.mkdir(parents=True)
    enabled_install = tmp_path / "enabled-install"
    write_skill_md(enabled_install / "skills" / "pluginskill", "Plugin skill")
    disabled_install = tmp_path / "disabled-install"
    write_skill_md(disabled_install / "skills" / "otherskill", "Disabled skill")
    (claude_dir / "settings.json").write_text(
        json.dumps(
            {"enabledPlugins": {"enabled@market": True, "disabled@market": False}}
        ),
        encoding="utf-8",
    )
    plugins_dir = claude_dir / "plugins"
    plugins_dir.mkdir()
    (plugins_dir / "installed_plugins.json").write_text(
        json.dumps(
            {
                "plugins": {
                    "enabled@market": [
                        {"installPath": str(enabled_install)},
                        {},
                    ],
                    "disabled@market": [{"installPath": str(disabled_install)}],
                }
            }
        ),
        encoding="utf-8",
    )

    response = await client.get(
        "/api/v1/skills", params={"workspace_id": workspace_id}, headers=headers
    )

    assert response.status_code == 200
    names = {item["name"] for item in response.json()}
    assert "pluginskill" in names
    assert "otherskill" not in names


async def test_real_skill_service_returns_no_plugin_skills_without_settings_files(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Server mode resolves the plugin config under the owner's agent home
    # (below STORAGE_PATH) — point it at the per-test tmp dir.
    monkeypatch.setattr(get_settings(), "STORAGE_PATH", str(tmp_path))

    headers, workspace_id, _path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-nohome@example.com",
        username="realskillnohome",
    )

    response = await client.get(
        "/api/v1/skills", params={"workspace_id": workspace_id}, headers=headers
    )

    assert response.status_code == 200
    # STORAGE_PATH is shared across the test session, so only assert this
    # workspace's own (nonexistent) skill is absent rather than the full list.
    assert "myskill" not in {item["name"] for item in response.json()}


async def test_real_skill_service_skips_malformed_plugin_settings_json(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Server mode resolves the plugin config under the owner's agent home —
    # workspace first, since the agent home is keyed by the owner's user id.
    monkeypatch.setattr(get_settings(), "STORAGE_PATH", str(tmp_path))
    headers, workspace_id, workspace_path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-badjson@example.com",
        username="realskillbadjson",
    )
    claude_dir = agent_home_for(workspace_path) / ".claude"
    claude_dir.mkdir(parents=True)
    (claude_dir / "settings.json").write_text("{not valid json", encoding="utf-8")
    plugins_dir = claude_dir / "plugins"
    plugins_dir.mkdir()
    (plugins_dir / "installed_plugins.json").write_text("{}", encoding="utf-8")

    response = await client.get(
        "/api/v1/skills", params={"workspace_id": workspace_id}, headers=headers
    )

    assert response.status_code == 200


async def test_real_skill_service_skips_plugin_discovery_without_enabled_plugins(
    client: AsyncClient,
    create_user: UserFactory,
    login: LoginClient,
    real_sandbox: None,
    real_skill_service: None,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Server mode resolves the plugin config under the owner's agent home —
    # workspace first, since the agent home is keyed by the owner's user id.
    monkeypatch.setattr(get_settings(), "STORAGE_PATH", str(tmp_path))
    headers, workspace_id, workspace_path = await create_real_workspace(
        client,
        create_user,
        login,
        email="real-skill-noenabled@example.com",
        username="realskillnoenabled",
    )
    claude_dir = agent_home_for(workspace_path) / ".claude"
    claude_dir.mkdir(parents=True)
    (claude_dir / "settings.json").write_text(
        json.dumps({"enabledPlugins": {}}), encoding="utf-8"
    )
    plugins_dir = claude_dir / "plugins"
    plugins_dir.mkdir()
    (plugins_dir / "installed_plugins.json").write_text(
        json.dumps({"plugins": {}}), encoding="utf-8"
    )

    response = await client.get(
        "/api/v1/skills", params={"workspace_id": workspace_id}, headers=headers
    )

    assert response.status_code == 200
