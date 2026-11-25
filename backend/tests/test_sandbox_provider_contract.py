import asyncio
import base64
import fcntl
import hashlib
import io
import tempfile
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import aiodocker
import aiohttp
import pytest
from aiodocker.exceptions import DockerError
from aiodocker.utils import mktar_from_dockerfile

from app.services.exceptions import SandboxException
from app.services.sandbox_providers.base import (
    HOST_GIT_ASKPASS_SCRIPT,
    SandboxProvider,
)
from app.services.sandbox_providers.docker_provider import (
    DOCKER_SANDBOX_CONTAINER_PREFIX,
    DockerConfig,
    LocalDockerProvider,
)
from app.services.sandbox_providers.host_provider import LocalHostProvider

pytestmark = pytest.mark.anyio

ASKPASS_SCRIPT_PATH = (
    Path(__file__).resolve().parents[2] / "sandbox/docker/git-askpass.sh"
)
TEST_DOCKERFILE = b"""\
FROM debian:bookworm-slim
RUN apt-get update \\
    && apt-get install -y --no-install-recommends git \\
    && rm -rf /var/lib/apt/lists/* \\
    && useradd -m -s /bin/bash -u 1000 user \\
    && install -d -o user -g user /home/user/workspace
"""
TEST_IMAGE = (
    f"agentrove-test-sandbox:{hashlib.sha256(TEST_DOCKERFILE).hexdigest()[:12]}"
)
TEST_IMAGE_LOCK = Path(tempfile.gettempdir()) / "agentrove-test-sandbox.lock"


@dataclass
class Sandbox:
    provider: SandboxProvider
    sandbox_id: str

    async def run(self, command: str) -> str:
        result = await self.provider.execute_command(self.sandbox_id, command)
        assert result.exit_code == 0, result.stdout + result.stderr
        return result.stdout

    async def seed(self, files: dict[str, str]) -> None:
        for path, content in files.items():
            await self.provider.write_file(self.sandbox_id, path, content)

    async def listing(self) -> list[tuple[str, str]]:
        files = await self.provider.list_files(self.sandbox_id)
        return sorted((f.path, f.type) for f in files)


async def ensure_test_image(docker: aiodocker.Docker) -> None:
    # xdist workers share the daemon: only one builds, the rest find the tag.
    with TEST_IMAGE_LOCK.open("w") as lock:
        await asyncio.to_thread(fcntl.flock, lock, fcntl.LOCK_EX)
        try:
            await docker.images.inspect(TEST_IMAGE)
            return
        except DockerError as e:
            if e.status != 404:
                raise
        await docker.images.build(
            fileobj=mktar_from_dockerfile(io.BytesIO(TEST_DOCKERFILE)),
            encoding="gzip",
            tag=TEST_IMAGE,
        )
        await docker.images.inspect(TEST_IMAGE)


async def open_docker_sandbox() -> AsyncIterator[Sandbox]:
    try:
        docker = aiodocker.Docker()
    except ValueError:
        pytest.skip("no Docker daemon reachable")
    try:
        try:
            await docker.version()
        except (aiohttp.ClientError, OSError):
            pytest.skip("no Docker daemon reachable")
        await ensure_test_image(docker)
        # The default bridge always exists, so nothing is left behind.
        provider = LocalDockerProvider(DockerConfig(image=TEST_IMAGE, network="bridge"))
        sandbox_id = await provider.create_sandbox()
        try:
            yield Sandbox(provider, sandbox_id)
        finally:
            await provider.cleanup()
            await docker.containers.container(
                f"{DOCKER_SANDBOX_CONTAINER_PREFIX}{sandbox_id}"
            ).delete(force=True)
    finally:
        await docker.close()


async def open_host_sandbox(workspace: Path) -> AsyncIterator[Sandbox]:
    workspace.mkdir()
    provider = LocalHostProvider(str(workspace))
    try:
        yield Sandbox(provider, await provider.create_sandbox())
    finally:
        await provider.cleanup()


@pytest.fixture(params=["host", "docker"])
async def sandbox(
    request: pytest.FixtureRequest, tmp_path: Path, anyio_backend: str
) -> AsyncIterator[Sandbox]:
    opened = (
        open_host_sandbox(tmp_path / "workspace")
        if request.param == "host"
        else open_docker_sandbox()
    )
    async for item in opened:
        yield item


def test_host_askpass_script_matches_sandbox_image_script() -> None:
    assert HOST_GIT_ASKPASS_SCRIPT == ASKPASS_SCRIPT_PATH.read_text()


async def test_write_then_read_round_trips_text_and_binary(sandbox: Sandbox) -> None:
    binary = b"PK\x03\x04\x00\xff binary"
    await sandbox.seed({"src/nested/app.py": "print('hi')\n"})
    await sandbox.provider.write_file(sandbox.sandbox_id, "logo.zip", binary)

    text = await sandbox.provider.read_file(sandbox.sandbox_id, "src/nested/app.py")
    archive = await sandbox.provider.read_file(sandbox.sandbox_id, "logo.zip")

    assert (text.content, text.is_binary) == ("print('hi')\n", False)
    assert archive.is_binary is True
    assert base64.b64decode(archive.content) == binary


@pytest.mark.parametrize("path", ["src", "missing.py", "escape-link"])
async def test_read_file_rejects_directory_missing_and_escaping_symlink(
    sandbox: Sandbox, path: str
) -> None:
    await sandbox.seed({"src/app.py": "x"})
    await sandbox.run("ln -s /etc/passwd escape-link")

    with pytest.raises(SandboxException):
        await sandbox.provider.read_file(sandbox.sandbox_id, path)


async def test_non_git_list_files_skips_walk_skip_dirs(sandbox: Sandbox) -> None:
    await sandbox.seed(
        {
            "README.md": "readme",
            "src/app.py": "x",
            "src/build": "a file, not a skipped directory",
            "node_modules/pkg/index.js": "x",
            "src/.venv/lib/site.py": "x",
            "src/pkg/__pycache__/mod.pyc": "x",
        }
    )

    assert await sandbox.listing() == [
        ("README.md", "file"),
        ("src", "directory"),
        ("src/app.py", "file"),
        ("src/build", "file"),
        ("src/pkg", "directory"),
    ]


async def test_git_list_files_honors_gitignore(sandbox: Sandbox) -> None:
    await sandbox.seed(
        {
            ".gitignore": "secrets.env\nout/\n",
            "src/a.py": "a",
            "secrets.env": "TOKEN=1",
            "out/bundle.js": "x",
        }
    )
    await sandbox.run("git init -q")

    assert await sandbox.listing() == [
        (".gitignore", "file"),
        ("src", "directory"),
        ("src/a.py", "file"),
    ]


async def test_execute_command_timeout_kills_foreground_and_background_children(
    sandbox: Sandbox,
) -> None:
    with pytest.raises(TimeoutError):
        await sandbox.provider.execute_command(
            sandbox.sandbox_id,
            "(sleep 2; touch background-marker) & sleep 2; touch foreground-marker",
            timeout=1,
        )

    await asyncio.sleep(3)

    assert await sandbox.run("ls") == ""
