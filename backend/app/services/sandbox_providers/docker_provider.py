import asyncio
import io
import logging
import posixpath
import shlex
import tarfile
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

import aiodocker
import aiohttp

from app.constants import (
    DOCKER_STATUS_RUNNING,
    SANDBOX_BINARY_EXTENSIONS,
    SANDBOX_DEFAULT_COMMAND_TIMEOUT,
    TERMINAL_TYPE,
)
from app.core.config import get_settings
from app.services.exceptions import SandboxException
from app.services.sandbox_providers.base import GIT_LS_FILES_CMD, SandboxProvider
from app.services.sandbox_providers.types import (
    CommandResult,
    FileContent,
    FileMetadata,
    PtyDataCallbackType,
    PtyExitCallbackType,
    PtySize,
)

logger = logging.getLogger(__name__)

DOCKER_SANDBOX_CONTAINER_PREFIX = "agentrove-sandbox-"


@dataclass
class DockerConfig:
    image: str = "agentrove-sandbox:latest"
    network: str = "agentrove-sandbox-net"
    host: str | None = None
    user_home: str = "/home/user"
    mem_limit: str = ""
    shm_size: str = ""
    cpu_period: int = 0
    cpu_quota: int = 0
    pids_limit: int = 0


class LocalDockerProvider(SandboxProvider):
    def __init__(self, config: DockerConfig) -> None:
        self.config = config
        self._containers: dict[str, Any] = {}
        self._pty_sessions: dict[str, dict[str, Any]] = {}
        self._docker: aiodocker.Docker | None = None

    @property
    def workspace_root(self) -> str:
        return f"{self.config.user_home}/workspace"

    async def _get_docker(self) -> aiodocker.Docker:
        if self._docker is None:
            try:
                if self.config.host:
                    self._docker = aiodocker.Docker(url=self.config.host)
                else:
                    self._docker = aiodocker.Docker()
            except ValueError as e:
                raise SandboxException(
                    f"Failed to connect to Docker — is Docker running? ({e})",
                    status_code=502,
                ) from e
        return self._docker

    @asynccontextmanager
    async def _docker_operation(
        self, operation: str, catch_timeout: bool = True
    ) -> AsyncIterator[None]:
        exception_types: tuple[type[Exception], ...] = (
            aiodocker.exceptions.DockerError,
            aiohttp.ClientError,
        )
        if catch_timeout:
            exception_types += (asyncio.TimeoutError,)
        try:
            yield
        except exception_types as e:
            is_connectivity_error = isinstance(
                e, (aiohttp.ClientError, asyncio.TimeoutError)
            ) or (isinstance(e, aiodocker.exceptions.DockerError) and e.status == 900)
            hint = " — is Docker running?" if is_connectivity_error else ""
            raise SandboxException(
                f"Failed to {operation}{hint} ({e})",
                status_code=502,
            ) from e

    @staticmethod
    def _parse_byte_size(size: str) -> int:
        size = size.strip().lower()
        if not size:
            return 0
        multipliers = {"k": 1024, "m": 1024**2, "g": 1024**3}
        if size[-1] in multipliers:
            return int(size[:-1]) * multipliers[size[-1]]
        return int(size)

    async def _get_container(self, sandbox_id: str) -> Any:
        # Reconnect if uncached; restart if the container has exited.
        if sandbox_id not in self._containers:
            connected = await self.connect_sandbox(sandbox_id)
            if not connected:
                raise SandboxException(f"Container {sandbox_id} not found")

        container = self._containers[sandbox_id]
        info = await container.show()
        if info["State"]["Status"] != DOCKER_STATUS_RUNNING:
            await container.start()
        return container

    async def _create_container(
        self,
        sandbox_id: str,
        workspace_path: str | None = None,
    ) -> Any:
        docker = await self._get_docker()

        host_config: dict[str, Any] = {
            "NetworkMode": self.config.network,
            "SecurityOpt": ["no-new-privileges=false"],
        }

        if self.config.mem_limit:
            host_config["Memory"] = self._parse_byte_size(self.config.mem_limit)
        if self.config.shm_size:
            host_config["ShmSize"] = self._parse_byte_size(self.config.shm_size)
        if self.config.cpu_period > 0:
            host_config["CpuPeriod"] = self.config.cpu_period
        if self.config.cpu_quota > 0:
            host_config["CpuQuota"] = self.config.cpu_quota
        if self.config.pids_limit > 0:
            host_config["PidsLimit"] = self.config.pids_limit

        workspace_mount_dir = f"{self.config.user_home}/workspace"
        if workspace_path:
            workspace_dir = Path(workspace_path).expanduser().resolve()
            host_config["Binds"] = [f"{workspace_dir}:{workspace_mount_dir}"]

        config: dict[str, Any] = {
            "Image": self.config.image,
            "Cmd": ["/bin/bash"],
            "Hostname": "sandbox",
            "User": "user",
            "WorkingDir": self.config.user_home,
            "OpenStdin": True,
            "Tty": True,
            "Env": [
                f"TERM={TERMINAL_TYPE}",
                f"HOME={self.config.user_home}",
                "USER=user",
            ],
            "HostConfig": host_config,
        }

        container_name = f"{DOCKER_SANDBOX_CONTAINER_PREFIX}{sandbox_id}"
        container = await docker.containers.create_or_replace(container_name, config)
        await container.start()
        return container

    async def create_sandbox(self, workspace_path: str | None = None) -> str:
        async with self._docker_operation("create Docker sandbox"):
            sandbox_id = str(uuid.uuid4())[:12]
            container = await self._create_container(
                sandbox_id, workspace_path=workspace_path
            )
            if workspace_path:
                await self._fix_workspace_ownership(container, workspace_path)
            self._containers[sandbox_id] = container
            return sandbox_id

    async def _fix_workspace_ownership(
        self, container: Any, workspace_path: str
    ) -> None:
        workspace_dir = Path(workspace_path).expanduser().resolve()
        storage_root = Path(get_settings().STORAGE_PATH).resolve()
        if not workspace_dir.is_relative_to(storage_root):
            return

        exec_obj = await container.exec(
            cmd=["chown", "-R", "1000:1000", self.workspace_root],
            user="root",
        )
        exit_code, output = await self._collect_exec_output(exec_obj)
        if exit_code != 0:
            logger.warning("Failed to set workspace ownership: %s", output)

    async def _get_container_by_id(self, sandbox_id: str) -> Any | None:
        # Daemon lookup when missing from the in-memory cache (e.g. after API restart).
        docker = await self._get_docker()
        try:
            return await docker.containers.get(
                f"{DOCKER_SANDBOX_CONTAINER_PREFIX}{sandbox_id}"
            )
        except aiodocker.exceptions.DockerError as e:
            if e.status == 404:
                return None
            raise

    async def connect_sandbox(self, sandbox_id: str) -> bool:
        async with self._docker_operation("connect to Docker sandbox"):
            if sandbox_id in self._containers:
                container = self._containers[sandbox_id]
                try:
                    info = await container.show()
                except aiodocker.exceptions.DockerError as e:
                    if e.status != 404:
                        raise
                    self._containers.pop(sandbox_id, None)
                else:
                    status: str = info.get("State", {}).get("Status", "")
                    if status == DOCKER_STATUS_RUNNING:
                        return True
                    self._containers.pop(sandbox_id, None)

            container = await self._get_container_by_id(sandbox_id)
            if container:
                self._containers[sandbox_id] = container
                return True

            return False

    async def delete_sandbox(self, sandbox_id: str) -> None:
        async with self._docker_operation("delete Docker sandbox"):
            container = self._containers.get(sandbox_id)

            if not container:
                container = await self._get_container_by_id(sandbox_id)
                if not container:
                    return

            try:
                try:
                    await container.stop(t=5)
                except aiodocker.exceptions.DockerError as e:
                    logger.warning(
                        "Failed to stop Docker sandbox %s: %s", sandbox_id, e
                    )
                await container.delete(force=True)
            finally:
                self._containers.pop(sandbox_id, None)

            logger.info("Successfully deleted Docker sandbox %s", sandbox_id)

    async def list_files(
        self,
        sandbox_id: str,
        path: str = "",
    ) -> list[FileMetadata]:
        target_path = self.resolve_workspace_path(path)

        # Prefer git ls-files so .gitignore is honored.
        git_result = await self.execute_command(
            sandbox_id,
            f"cd {shlex.quote(target_path)} && {GIT_LS_FILES_CMD}",
            timeout=10,
        )
        if git_result.exit_code == 0 and git_result.stdout:
            return SandboxProvider.parse_git_ls_files(git_result.stdout)

        # Non-git fallback.
        find_command = (
            f"find {shlex.quote(target_path)} -mindepth 1 -printf '%P\\0%y\\0'"
        )
        result = await self.execute_command(sandbox_id, find_command, timeout=30)
        return self._parse_find_output(result.stdout)

    @staticmethod
    def _parse_find_output(find_output: str) -> list[FileMetadata]:
        # Parse GNU find -printf '%P\0%y\0' pairs.
        items: list[FileMetadata] = []
        parts = find_output.split("\0")
        for i in range(0, len(parts) - 1, 2):
            file_path = parts[i]
            file_type = parts[i + 1]
            if not file_path:
                continue

            if file_type == "f":
                ext = Path(file_path).suffix.lstrip(".").lower()
                items.append(
                    FileMetadata(
                        path=file_path,
                        type="file",
                        is_binary=ext in SANDBOX_BINARY_EXTENSIONS,
                    )
                )
            elif file_type == "d":
                items.append(FileMetadata(path=file_path, type="directory"))

        return items

    async def _collect_exec_output(self, exec_obj: Any) -> tuple[int, str]:
        stream = exec_obj.start()
        output_parts: list[bytes] = []
        try:
            while True:
                msg = await stream.read_out()
                if msg is None:
                    break
                output_parts.append(msg.data)
        finally:
            try:
                await stream.close()
            except Exception:
                pass
        exec_info = await exec_obj.inspect()
        exit_code = exec_info.get("ExitCode", -1)
        output = b"".join(output_parts).decode("utf-8", errors="replace")
        return exit_code, output

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        envs: dict[str, str] | None = None,
        timeout: int = SANDBOX_DEFAULT_COMMAND_TIMEOUT,
    ) -> CommandResult:
        async with self._docker_operation(
            "execute Docker command", catch_timeout=False
        ):
            # aiodocker merges stdout/stderr, so stderr is always empty.
            container = await self._get_container(sandbox_id)
            env_list = [f"{k}={v}" for k, v in (envs or {}).items()]

            # Exec from the workspace root so relative cwd prefixes (e.g.
            # `cd '.worktrees/abc' && ...`) resolve against the project files,
            # not the user's home dir.
            exec_obj = await container.exec(
                cmd=["bash", "-c", command],
                environment=env_list,
                workdir=self.workspace_root,
            )

            try:
                exit_code, output_str = await asyncio.wait_for(
                    self._collect_exec_output(exec_obj),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                raise TimeoutError(f"Command execution timed out after {timeout}s")

            return CommandResult(stdout=output_str, stderr="", exit_code=exit_code)

    @staticmethod
    def _build_file_tar(filename: str, content_bytes: bytes) -> bytes:
        # put_archive needs a tar; uid/gid 1000 is the sandbox user.
        tar_stream = io.BytesIO()
        with tarfile.open(fileobj=tar_stream, mode="w") as tar:
            info = tarfile.TarInfo(name=filename)
            info.size = len(content_bytes)
            info.uid = 1000
            info.gid = 1000
            tar.addfile(info, io.BytesIO(content_bytes))
        tar_stream.seek(0)
        return tar_stream.read()

    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        async with self._docker_operation("write file in Docker sandbox"):
            container = await self._get_container(sandbox_id)
            normalized_path = self.resolve_workspace_path(path)
            content_bytes = (
                content.encode("utf-8") if isinstance(content, str) else content
            )

            parent_dir = str(Path(normalized_path).parent)
            mkdir_exec = await container.exec(
                cmd=["mkdir", "-p", parent_dir],
            )
            mkdir_exit_code, mkdir_output = await self._collect_exec_output(mkdir_exec)
            if mkdir_exit_code != 0:
                raise SandboxException(
                    f"Failed to create directory {parent_dir}: {mkdir_output}"
                )
            tar = self._build_file_tar(Path(normalized_path).name, content_bytes)
            await container.put_archive(parent_dir, tar)

    async def write_temp_file(self, sandbox_id: str, content: str) -> str:
        async with self._docker_operation("write temporary file in Docker sandbox"):
            # /tmp always exists and is world-writable, so no mkdir is needed.
            container = await self._get_container(sandbox_id)
            filename = f"agentrove-codex-{uuid.uuid4().hex}.md"
            tar = self._build_file_tar(filename, content.encode("utf-8"))
            await container.put_archive("/tmp", tar)
            return posixpath.join("/tmp", filename)

    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        async with self._docker_operation("read file from Docker sandbox"):
            # get_archive returns a tar; take the first member.
            container = await self._get_container(sandbox_id)
            normalized_path = self.resolve_workspace_path(path)

            tar_obj = await container.get_archive(normalized_path)

            content_bytes = b""
            members = tar_obj.getmembers()
            if members:
                f = tar_obj.extractfile(members[0])
                if f:
                    content_bytes = f.read()

            content, is_binary = self.encode_file_content(path, content_bytes)

            return FileContent(
                path=path,
                content=content,
                type="file",
                is_binary=is_binary,
            )

    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        cwd: str,
        on_data: PtyDataCallbackType,
        on_exit: PtyExitCallbackType,
        user_id: str = "",
    ) -> str:
        async with self._docker_operation("create Docker terminal"):
            # tmux for reconnect persistence; bare bash if missing. user_id unused (fixed container HOME).
            container = await self._get_container(sandbox_id)
            session_id = str(uuid.uuid4())

            cmd = [
                "bash",
                "-c",
                self.build_pty_shell_command(tmux_session, "bash"),
            ]

            # Root terminals keep $HOME as the start dir (dotfiles, existing
            # behavior); worktree terminals must start inside the worktree.
            workdir = self.resolve_workspace_path(cwd) if cwd else self.config.user_home
            exec_obj = await container.exec(
                cmd=cmd,
                stdin=True,
                tty=True,
                environment={"TERM": TERMINAL_TYPE},
                workdir=workdir,
            )
            stream = exec_obj.start()
            # aiodocker creates the stream lazily — _init() opens the actual
            # WebSocket to the Docker daemon. No public API exists for this.
            await stream._init()

            reader_task = asyncio.create_task(
                self._pty_reader(stream, on_data, on_exit)
            )
            self.register_pty_session(
                sandbox_id,
                session_id,
                {
                    "exec": exec_obj,
                    "stream": stream,
                    "reader_task": reader_task,
                },
            )

            if rows > 0 and cols > 0:
                await self.resize_pty(
                    sandbox_id, session_id, PtySize(rows=rows, cols=cols)
                )

            return session_id

    async def _pty_reader(
        self,
        stream: Any,
        on_data: PtyDataCallbackType,
        on_exit: PtyExitCallbackType,
    ) -> None:
        try:
            while True:
                msg = await stream.read_out()
                if msg is None:
                    break
                await on_data(msg.data)
        except asyncio.CancelledError:
            return
        except Exception as e:
            # A dead exec stream (container restarted/removed) is also a
            # terminal condition — fall through to on_exit.
            logger.error("PTY reader error: %s", e)
        on_exit()

    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        async with self._docker_operation("send Docker terminal input"):
            session = self.get_pty_session(sandbox_id, pty_id)
            if not session:
                return

            await session["stream"].write_in(data)

    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        async with self._docker_operation("resize Docker terminal"):
            # Docker rejects zero dimensions — clamp to at least 1.
            session = self.get_pty_session(sandbox_id, pty_id)
            if not session:
                return

            await session["exec"].resize(h=max(size.rows, 1), w=max(size.cols, 1))

    async def kill_pty(
        self,
        sandbox_id: str,
        pty_id: str,
    ) -> None:
        session = self.get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        try:
            reader_task = session["reader_task"]
            reader_task.cancel()
            try:
                await reader_task
            except asyncio.CancelledError:
                pass
        finally:
            try:
                await session["stream"].close()
            except Exception:
                pass
            self.cleanup_pty_session_tracking(sandbox_id, pty_id)

    async def cleanup(self) -> None:
        await super().cleanup()
        if self._docker:
            await self._docker.close()
            self._docker = None
