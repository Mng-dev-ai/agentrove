import asyncio
import base64
import io
import logging
import shlex
import tarfile
import uuid
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Awaitable, Callable, TypeVar

import posixpath

from app.constants import (
    CHECKPOINT_BASE_DIR,
    DOCKER_AVAILABLE_PORTS,
    MAX_CHECKPOINTS_PER_SANDBOX,
    SANDBOX_BINARY_EXTENSIONS,
    SANDBOX_DEFAULT_COMMAND_TIMEOUT,
    SANDBOX_EXCLUDED_PATHS,
    SANDBOX_RESTORE_EXCLUDE_PATTERNS,
    SANDBOX_SYSTEM_VARIABLES,
    VNC_WEBSOCKET_PORT,
)
from app.services.exceptions import SandboxException
from app.services.sandbox.types import (
    CheckpointInfo,
    CommandResult,
    DockerConfig,
    FileContent,
    FileMetadata,
    PreviewLink,
    PtyDataCallbackType,
    PtySession,
    PtySize,
    SecretEntry,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

LISTENING_PORTS_COMMAND = "ss -tuln | grep LISTEN | awk '{print $5}' | sed 's/.*://g' | grep -E '^[0-9]+$' | sort -u"


class SandboxProvider(ABC):
    _pty_sessions: dict[str, dict[str, Any]]

    @staticmethod
    def normalize_path(file_path: str, base: str = "/home/user") -> str:
        path = PurePosixPath(file_path)

        if path.is_absolute() and str(path).startswith(base):
            return posixpath.normpath(str(path))
        elif path.is_absolute():
            return posixpath.normpath(f"{base}{path}")
        return posixpath.normpath(f"{base}/{path}")

    @staticmethod
    def format_export_command(key: str, value: str) -> str:
        escaped_value = value.replace("'", "'\"'\"'")
        return f"export {key}='{escaped_value}'"

    def _get_system_variables(self) -> list[str]:
        return SANDBOX_SYSTEM_VARIABLES

    @staticmethod
    def _is_binary_file(path: str) -> bool:
        return Path(path).suffix.lstrip(".").lower() in SANDBOX_BINARY_EXTENSIONS

    @staticmethod
    def _encode_file_content(path: str, content_bytes: bytes) -> tuple[str, bool]:
        is_binary = SandboxProvider._is_binary_file(path)
        if is_binary:
            content = base64.b64encode(content_bytes).decode("utf-8")
        else:
            content = content_bytes.decode("utf-8", errors="replace")
        return content, is_binary

    @staticmethod
    async def _execute_with_timeout(
        coro: Awaitable[T],
        timeout: int,
        error_msg: str | None = None,
    ) -> T:
        try:
            return await asyncio.wait_for(coro, timeout=timeout + 5)
        except asyncio.TimeoutError:
            raise TimeoutError(error_msg or f"Operation timed out after {timeout}s")

    @staticmethod
    def _parse_listening_ports(stdout: str) -> set[int]:
        return {int(p) for p in stdout.strip().splitlines() if p.isdigit()}

    def _build_preview_links(
        self,
        listening_ports: set[int],
        url_builder: Callable[[int], str],
        excluded_ports: set[int] | None = None,
    ) -> list[PreviewLink]:
        excluded = excluded_ports or set()
        preview_links: list[PreviewLink] = []
        for port in listening_ports:
            if port in excluded:
                continue
            preview_url = url_builder(port)
            preview_links.append(PreviewLink(preview_url=preview_url, port=port))
        return preview_links

    async def _get_latest_checkpoint_dir(self, sandbox_id: str) -> str | None:
        checkpoints = await self.list_checkpoints(sandbox_id)
        if not checkpoints:
            return None
        return f"{CHECKPOINT_BASE_DIR}/{checkpoints[0].message_id}"

    async def _cleanup_old_checkpoints(self, sandbox_id: str) -> int:
        checkpoints = await self.list_checkpoints(sandbox_id)

        if len(checkpoints) <= MAX_CHECKPOINTS_PER_SANDBOX:
            return 0

        to_delete = checkpoints[MAX_CHECKPOINTS_PER_SANDBOX:]
        deleted_count = 0

        for checkpoint in to_delete:
            checkpoint_dir = f"{CHECKPOINT_BASE_DIR}/{checkpoint.message_id}"
            await self.execute_command(
                sandbox_id, f"rm -rf {shlex.quote(checkpoint_dir)}"
            )
            deleted_count += 1

        return deleted_count

    def _get_pty_session(
        self, sandbox_id: str, session_id: str
    ) -> dict[str, Any] | None:
        return self._pty_sessions.get(sandbox_id, {}).get(session_id)

    def _register_pty_session(
        self, sandbox_id: str, session_id: str, session_data: dict[str, Any]
    ) -> None:
        if sandbox_id not in self._pty_sessions:
            self._pty_sessions[sandbox_id] = {}
        self._pty_sessions[sandbox_id][session_id] = session_data

    def _cleanup_pty_session_tracking(self, sandbox_id: str, session_id: str) -> None:
        try:
            del self._pty_sessions[sandbox_id][session_id]
            if not self._pty_sessions[sandbox_id]:
                del self._pty_sessions[sandbox_id]
        except Exception as e:
            logger.error("Error cleaning up PTY session %s: %s", session_id, e)

    @abstractmethod
    async def create_sandbox(self) -> str:
        pass

    @abstractmethod
    async def connect_sandbox(self, sandbox_id: str) -> bool:
        pass

    @abstractmethod
    async def delete_sandbox(self, sandbox_id: str) -> None:
        pass

    async def clone_sandbox(
        self, source_sandbox_id: str, checkpoint_id: str | None = None
    ) -> str:
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support sandbox cloning"
        )

    @abstractmethod
    async def is_running(self, sandbox_id: str) -> bool:
        pass

    @abstractmethod
    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        background: bool = False,
        envs: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> CommandResult:
        pass

    @abstractmethod
    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        pass

    @abstractmethod
    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        pass

    async def list_files(
        self,
        sandbox_id: str,
        path: str = "/home/user",
        excluded_patterns: list[str] | None = None,
    ) -> list[FileMetadata]:
        patterns = excluded_patterns or SANDBOX_EXCLUDED_PATHS

        exclude_conditions = []
        for pattern in patterns:
            if pattern.startswith("*."):
                exclude_conditions.append(f"-not -name '{pattern}'")
            else:
                exclude_conditions.append(f"-not -path '{pattern}'")

        exclude_args = " ".join(exclude_conditions)
        find_command = f"find {path} {exclude_args} -printf '%p\t%y\t%s\t%T@\n'"

        result = await self.execute_command(sandbox_id, find_command, timeout=30)

        metadata_items = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue

            parts = line.split("\t")
            if len(parts) < 4:
                continue

            file_path, file_type, size, mtime = parts[0], parts[1], parts[2], parts[3]

            if not file_path or file_path == "/home/user" or file_path == "":
                continue

            if file_path.startswith("/home/user/"):
                file_path = file_path[11:]
            elif file_path.startswith("/home/user"):
                file_path = file_path[10:]

            if file_type == "f":
                is_binary = (
                    Path(file_path).suffix.lstrip(".").lower()
                    in SANDBOX_BINARY_EXTENSIONS
                )
                metadata_items.append(
                    FileMetadata(
                        path=file_path,
                        type="file",
                        is_binary=is_binary,
                        size=int(size) if size.isdigit() else 0,
                        modified=float(mtime)
                        if mtime.replace(".", "").isdigit()
                        else 0,
                    )
                )
            elif file_type == "d":
                metadata_items.append(
                    FileMetadata(
                        path=file_path,
                        type="directory",
                        size=0,
                        modified=float(mtime)
                        if mtime.replace(".", "").isdigit()
                        else 0,
                    )
                )

        return metadata_items

    @abstractmethod
    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        on_data: PtyDataCallbackType | None = None,
    ) -> PtySession:
        pass

    @abstractmethod
    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        pass

    @abstractmethod
    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        pass

    @abstractmethod
    async def kill_pty(
        self,
        sandbox_id: str,
        pty_id: str,
    ) -> None:
        pass

    @abstractmethod
    async def get_preview_links(self, sandbox_id: str) -> list[PreviewLink]:
        pass

    async def create_checkpoint(
        self,
        sandbox_id: str,
        checkpoint_id: str,
    ) -> str:
        checkpoint_dir = f"{CHECKPOINT_BASE_DIR}/{checkpoint_id}"

        await self.execute_command(
            sandbox_id, f"mkdir -p {shlex.quote(CHECKPOINT_BASE_DIR)}"
        )

        prev_checkpoint = await self._get_latest_checkpoint_dir(sandbox_id)

        exclude_args = " ".join(
            f"--exclude={shlex.quote(pattern)}"
            for pattern in SANDBOX_RESTORE_EXCLUDE_PATTERNS
        )

        if prev_checkpoint:
            rsync_cmd = (
                f"rsync -a --delete "
                f"--link-dest={shlex.quote(prev_checkpoint)} "
                f"{exclude_args} "
                f"/home/user/ {shlex.quote(checkpoint_dir)}/"
            )
        else:
            rsync_cmd = (
                f"rsync -a --delete "
                f"{exclude_args} "
                f"/home/user/ {shlex.quote(checkpoint_dir)}/"
            )

        try:
            await self.execute_command(sandbox_id, rsync_cmd)
        except Exception as e:
            logger.error("Checkpoint creation failed for %s: %s", checkpoint_id, e)
            try:
                await self.execute_command(
                    sandbox_id, f"rm -rf {shlex.quote(checkpoint_dir)}"
                )
            except Exception:
                pass
            raise

        await self._cleanup_old_checkpoints(sandbox_id)
        return checkpoint_id

    async def restore_checkpoint(
        self,
        sandbox_id: str,
        checkpoint_id: str,
    ) -> bool:
        checkpoint_dir = f"{CHECKPOINT_BASE_DIR}/{checkpoint_id}"

        check_result = await self.execute_command(
            sandbox_id, f'[ -d {shlex.quote(checkpoint_dir)} ] && echo "1" || echo "0"'
        )

        if check_result.stdout.strip() != "1":
            raise FileNotFoundError(f"Checkpoint {checkpoint_id} not found")

        exclude_args = " ".join(
            f"--exclude={shlex.quote(pattern)}"
            for pattern in SANDBOX_RESTORE_EXCLUDE_PATTERNS
        )

        rsync_cmd = (
            f"rsync -a --delete "
            f"{exclude_args} "
            f"--stats "
            f"{shlex.quote(checkpoint_dir)}/ /home/user/"
        )

        await self.execute_command(sandbox_id, rsync_cmd)
        return True

    async def list_checkpoints(self, sandbox_id: str) -> list[CheckpointInfo]:
        check_result = await self.execute_command(
            sandbox_id,
            f'[ -d {shlex.quote(CHECKPOINT_BASE_DIR)} ] && echo "1" || echo "0"',
        )

        if check_result.stdout.strip() != "1":
            return []

        list_cmd = (
            f"cd {shlex.quote(CHECKPOINT_BASE_DIR)} && "
            f"for dir in */; do "
            f'if [ -d "$dir" ]; then '
            f'echo "${{dir%/}}|$(stat -c %Y "$dir")"; '
            f"fi; "
            f"done"
        )

        result = await self.execute_command(sandbox_id, list_cmd)

        if not result.stdout.strip():
            return []

        checkpoints = []
        for line in result.stdout.strip().split("\n"):
            if "|" not in line:
                continue
            parts = line.split("|")
            if len(parts) != 2:
                continue

            message_id, timestamp = parts
            try:
                ts = int(timestamp)
            except ValueError:
                continue
            checkpoints.append(
                CheckpointInfo(
                    message_id=message_id,
                    created_at=datetime.fromtimestamp(ts).isoformat(),
                )
            )

        checkpoints.sort(key=lambda x: x.created_at, reverse=True)
        return checkpoints

    async def get_secrets(self, sandbox_id: str) -> list[SecretEntry]:
        result = await self.execute_command(
            sandbox_id,
            "grep '^export' ~/.bashrc | sed 's/^export //g'",
            timeout=5,
        )

        env_lines = result.stdout.strip().split("\n")
        secrets = []
        system_vars = self._get_system_variables()

        for line in env_lines:
            if "=" in line:
                key, value = line.split("=", 1)
                value = value.strip('"').strip("'")

                if key not in system_vars:
                    secrets.append(SecretEntry(key=key, value=value))

        return secrets

    async def add_secret(
        self,
        sandbox_id: str,
        key: str,
        value: str,
    ) -> None:
        export_command = self.format_export_command(key, value)
        await self.execute_command(sandbox_id, f'echo "{export_command}" >> ~/.bashrc')

    async def delete_secret(
        self,
        sandbox_id: str,
        key: str,
    ) -> None:
        escaped_key = key.replace(".", r"\.").replace("*", r"\*")
        await self.execute_command(
            sandbox_id, f"sed -i '/^export {escaped_key}=/d' ~/.bashrc"
        )

    async def cleanup(self) -> None:
        for sandbox_id in list(self._pty_sessions.keys()):
            for session_id in list(self._pty_sessions[sandbox_id].keys()):
                try:
                    await self.kill_pty(sandbox_id, session_id)
                except Exception as e:
                    logger.warning(
                        "Failed to cleanup PTY session %s for sandbox %s: %s",
                        session_id,
                        sandbox_id,
                        e,
                    )

    @abstractmethod
    async def get_ide_url(self, sandbox_id: str) -> str | None:
        pass

    async def get_vnc_url(self, sandbox_id: str) -> str | None:
        return None

    async def __aenter__(self) -> "SandboxProvider":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> bool:
        await self.cleanup()
        return False


class LocalDockerProvider(SandboxProvider):
    def __init__(self, config: DockerConfig) -> None:
        self.config = config
        self._executor = ThreadPoolExecutor(max_workers=10)
        self._containers: dict[str, Any] = {}
        self._pty_sessions: dict[str, dict[str, Any]] = {}
        self._port_mappings: dict[str, dict[int, int]] = {}
        self._docker_client: Any = None

    def _get_docker_client(self) -> Any:
        if self._docker_client is None:
            try:
                import docker

                if self.config.host:
                    self._docker_client = docker.DockerClient(base_url=self.config.host)
                else:
                    self._docker_client = docker.from_env()
            except ImportError:
                raise SandboxException(
                    "Docker SDK not installed. Run: pip install docker"
                )
            except Exception as e:
                raise SandboxException(f"Failed to connect to Docker: {e}")
        return self._docker_client

    def _build_traefik_labels(self, sandbox_id: str) -> dict[str, str]:
        if not self.config.sandbox_domain or not self.config.traefik_network:
            return {}

        labels: dict[str, str] = {"traefik.enable": "true"}
        all_ports = [self.config.openvscode_port] + list(DOCKER_AVAILABLE_PORTS)

        for port in all_ports:
            router_name = f"sandbox-{sandbox_id}-{port}"
            subdomain = f"{router_name}.{self.config.sandbox_domain}"
            labels[f"traefik.http.routers.{router_name}.rule"] = f"Host(`{subdomain}`)"
            labels[f"traefik.http.routers.{router_name}.entrypoints"] = "https"
            labels[f"traefik.http.routers.{router_name}.tls"] = "true"
            labels[f"traefik.http.routers.{router_name}.service"] = router_name
            labels[f"traefik.http.services.{router_name}.loadbalancer.server.port"] = (
                str(port)
            )

        return labels

    def _create_container(self, sandbox_id: str) -> Any:
        client = self._get_docker_client()
        labels = self._build_traefik_labels(sandbox_id)
        network = self.config.traefik_network or self.config.network

        container = client.containers.run(
            self.config.image,
            command="/bin/bash",
            name=f"claudex-sandbox-{sandbox_id}",
            hostname="sandbox",
            user="user",
            working_dir=self.config.user_home,
            stdin_open=True,
            tty=True,
            detach=True,
            remove=False,
            privileged=True,
            security_opt=["no-new-privileges=false"],
            network=network,
            labels=labels,
            ports={
                **{f"{port}/tcp": None for port in DOCKER_AVAILABLE_PORTS},
                f"{self.config.openvscode_port}/tcp": None,
            },
            environment={
                "TERM": "xterm-256color",
                "HOME": self.config.user_home,
                "USER": "user",
                "OPENVSCODE_PORT": str(self.config.openvscode_port),
            },
        )
        return container

    async def create_sandbox(self) -> str:
        loop = asyncio.get_running_loop()
        sandbox_id = str(uuid.uuid4())[:12]

        try:
            container = await loop.run_in_executor(
                self._executor, lambda: self._create_container(sandbox_id)
            )
            self._containers[sandbox_id] = container

            port_map = await loop.run_in_executor(
                self._executor, lambda: self._extract_port_mappings(container)
            )
            self._port_mappings[sandbox_id] = port_map

            return sandbox_id
        except Exception as e:
            raise SandboxException(f"Failed to create Docker sandbox: {e}")

    async def _start_ide_server(self, sandbox_id: str) -> None:
        try:
            await self.execute_command(
                sandbox_id,
                f"nohup openvscode-server --port={self.config.openvscode_port} "
                f"--host=0.0.0.0 --without-connection-token > /dev/null 2>&1 &",
                background=True,
                timeout=5,
            )
        except Exception as e:
            logger.warning(
                "Failed to start IDE server for sandbox %s: %s", sandbox_id, e
            )

    async def _ensure_ide_server_running(self, sandbox_id: str) -> None:
        try:
            result = await self.execute_command(
                sandbox_id,
                f"ss -tuln | grep -q ':{self.config.openvscode_port}' && echo 'running' || echo 'stopped'",
                timeout=5,
            )
            if "stopped" in result.stdout:
                await self._start_ide_server(sandbox_id)
        except Exception as e:
            logger.warning(
                "Failed to check IDE server status for sandbox %s: %s", sandbox_id, e
            )

    @staticmethod
    def _extract_port_mappings(container: Any) -> dict[int, int]:
        container.reload()
        ports = container.attrs.get("NetworkSettings", {}).get("Ports", {})
        port_map: dict[int, int] = {}
        for container_port, host_bindings in ports.items():
            if (
                host_bindings
                and isinstance(host_bindings, list)
                and len(host_bindings) > 0
            ):
                host_port = host_bindings[0].get("HostPort")
                if host_port:
                    internal_port = int(container_port.split("/")[0])
                    port_map[internal_port] = int(host_port)
        return port_map

    def _is_container_running(self, container: Any) -> bool:
        container.reload()
        return bool(container.status == "running")

    def _get_container_by_id(self, sandbox_id: str) -> Any | None:
        client = self._get_docker_client()
        try:
            return client.containers.get(f"claudex-sandbox-{sandbox_id}")
        except Exception:
            return None

    async def connect_sandbox(self, sandbox_id: str) -> bool:
        if sandbox_id in self._containers:
            container = self._containers[sandbox_id]
            loop = asyncio.get_running_loop()

            is_running = await loop.run_in_executor(
                self._executor, lambda: self._is_container_running(container)
            )
            if is_running:
                await self._ensure_ide_server_running(sandbox_id)
                return True
            del self._containers[sandbox_id]

        loop = asyncio.get_running_loop()

        container = await loop.run_in_executor(
            self._executor, lambda: self._get_container_by_id(sandbox_id)
        )
        if container:
            self._containers[sandbox_id] = container
            port_mappings = await loop.run_in_executor(
                self._executor, lambda: self._extract_port_mappings(container)
            )
            self._port_mappings[sandbox_id] = port_mappings
            await self._ensure_ide_server_running(sandbox_id)
            return True

        return False

    async def delete_sandbox(self, sandbox_id: str) -> None:
        container = self._containers.get(sandbox_id)

        if not container:
            try:
                container = await self._find_container_by_name(sandbox_id)
            except Exception:
                return

        await self._destroy_container(container)

        if sandbox_id in self._containers:
            del self._containers[sandbox_id]
        if sandbox_id in self._port_mappings:
            del self._port_mappings[sandbox_id]

        logger.info("Successfully deleted Docker sandbox %s", sandbox_id)

    async def is_running(self, sandbox_id: str) -> bool:
        container = self._containers.get(sandbox_id)
        if not container:
            return False

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self._executor, lambda: self._is_container_running(container)
        )

    def _run_command(
        self,
        container: Any,
        command: str,
        env_list: list[str],
        background: bool,
    ) -> tuple[int, bytes]:
        result = container.exec_run(
            cmd=["bash", "-c", command],
            environment=env_list,
            workdir=self.config.user_home,
            demux=True,
            detach=background,
        )
        if background:
            return 0, b"Background process started"
        exit_code = result.exit_code
        stdout, stderr = result.output or (b"", b"")
        return exit_code, (stdout or b"") + (stderr or b"")

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        background: bool = False,
        envs: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> CommandResult:
        container = await self._get_container(sandbox_id)
        loop = asyncio.get_running_loop()
        env_list = [f"{k}={v}" for k, v in (envs or {}).items()]

        effective_timeout = timeout or SANDBOX_DEFAULT_COMMAND_TIMEOUT

        exit_code, output = await self._execute_with_timeout(
            loop.run_in_executor(
                self._executor,
                lambda: self._run_command(container, command, env_list, background),
            ),
            effective_timeout,
            f"Command execution timed out after {effective_timeout}s",
        )

        output_str = output.decode("utf-8", errors="replace")
        return CommandResult(stdout=output_str, stderr="", exit_code=exit_code)

    def _write_container_file(
        self,
        container: Any,
        normalized_path: str,
        content_bytes: bytes,
    ) -> None:
        tar_stream = io.BytesIO()
        with tarfile.open(fileobj=tar_stream, mode="w") as tar:
            file_data = io.BytesIO(content_bytes)
            info = tarfile.TarInfo(name=Path(normalized_path).name)
            info.size = len(content_bytes)
            tar.addfile(info, file_data)
        tar_stream.seek(0)

        parent_dir = str(Path(normalized_path).parent)
        container.exec_run(f"mkdir -p {shlex.quote(parent_dir)}")
        container.put_archive(parent_dir, tar_stream.read())

    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        container = await self._get_container(sandbox_id)
        normalized_path = self.normalize_path(path)
        loop = asyncio.get_running_loop()

        if isinstance(content, str):
            content_bytes = content.encode("utf-8")
        else:
            content_bytes = content

        await loop.run_in_executor(
            self._executor,
            lambda: self._write_container_file(
                container, normalized_path, content_bytes
            ),
        )

    def _read_container_file(self, container: Any, normalized_path: str) -> bytes:
        bits, _ = container.get_archive(normalized_path)
        stream = io.BytesIO()
        for chunk in bits:
            stream.write(chunk)
        stream.seek(0)

        with tarfile.open(fileobj=stream, mode="r") as tar:
            members = tar.getmembers()
            if not members:
                return b""
            f = tar.extractfile(members[0])
            if f:
                return f.read()
        return b""

    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        container = await self._get_container(sandbox_id)
        normalized_path = self.normalize_path(path)
        loop = asyncio.get_running_loop()

        content_bytes = await loop.run_in_executor(
            self._executor,
            lambda: self._read_container_file(container, normalized_path),
        )

        content, is_binary = self._encode_file_content(path, content_bytes)

        return FileContent(
            path=path,
            content=content,
            type="file",
            is_binary=is_binary,
        )

    def _create_pty_exec(self, container: Any) -> tuple[dict[str, Any], Any]:
        exec_id = container.client.api.exec_create(
            container.id,
            cmd="/bin/bash",
            stdin=True,
            tty=True,
            environment={"TERM": "xterm-256color"},
            workdir=self.config.user_home,
        )
        socket = container.client.api.exec_start(
            exec_id["Id"],
            socket=True,
            tty=True,
        )
        return exec_id, socket

    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        on_data: PtyDataCallbackType | None = None,
    ) -> PtySession:
        container = await self._get_container(sandbox_id)
        session_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()

        exec_info, socket = await loop.run_in_executor(
            self._executor, lambda: self._create_pty_exec(container)
        )

        self._register_pty_session(
            sandbox_id,
            session_id,
            {
                "exec_id": exec_info["Id"],
                "socket": socket,
                "container": container,
                "on_data": on_data,
                "reader_task": None,
            },
        )

        if on_data:
            reader_task = asyncio.create_task(
                self._pty_reader(sandbox_id, session_id, socket, on_data)
            )
            self._pty_sessions[sandbox_id][session_id]["reader_task"] = reader_task

        if rows > 0 and cols > 0:
            await self.resize_pty(sandbox_id, session_id, PtySize(rows=rows, cols=cols))

        return PtySession(
            id=session_id,
            pid=None,
            rows=rows,
            cols=cols,
        )

    async def _pty_reader(
        self,
        sandbox_id: str,
        session_id: str,
        socket: Any,
        on_data: PtyDataCallbackType,
    ) -> None:
        loop = asyncio.get_running_loop()

        def read_socket() -> bytes | None:
            try:
                return bytes(socket._sock.recv(4096))
            except Exception:
                return None

        try:
            while True:
                data = await loop.run_in_executor(self._executor, read_socket)
                if data is None or len(data) == 0:
                    break
                await on_data(data)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("PTY reader error: %s", e)

    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        socket = session.get("socket")
        if not socket:
            return

        loop = asyncio.get_running_loop()

        await loop.run_in_executor(self._executor, lambda: socket._sock.send(data))

    @staticmethod
    def _resize_pty(container: Any, exec_id: str, rows: int, cols: int) -> None:
        container.client.api.exec_resize(
            exec_id,
            height=max(rows, 1),
            width=max(cols, 1),
        )

    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        container = session.get("container")
        exec_id = session.get("exec_id")
        if not container or not exec_id:
            return

        loop = asyncio.get_running_loop()

        await loop.run_in_executor(
            self._executor,
            lambda: self._resize_pty(container, exec_id, size.rows, size.cols),
        )

    async def kill_pty(
        self,
        sandbox_id: str,
        pty_id: str,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        reader_task = session.get("reader_task")
        if reader_task:
            reader_task.cancel()
            try:
                await reader_task
            except asyncio.CancelledError:
                pass

        socket = session.get("socket")
        if socket:
            try:
                socket.close()
            except Exception:
                pass

        self._cleanup_pty_session_tracking(sandbox_id, pty_id)

    async def get_preview_links(self, sandbox_id: str) -> list[PreviewLink]:
        await self._get_container(sandbox_id)

        result = await self.execute_command(
            sandbox_id,
            LISTENING_PORTS_COMMAND,
            timeout=5,
        )
        listening_ports = self._parse_listening_ports(result.stdout)

        port_map = self._port_mappings.get(sandbox_id, {})
        mapped_ports = {p for p in listening_ports if p in port_map}

        return self._build_preview_links(
            listening_ports=mapped_ports,
            url_builder=(
                (
                    lambda port: f"https://sandbox-{sandbox_id}-{port}.{self.config.sandbox_domain}"
                )
                if self.config.sandbox_domain
                else (lambda port: f"{self.config.preview_base_url}:{port_map[port]}")
            ),
            excluded_ports={self.config.openvscode_port},
        )

    async def _find_container_by_name(self, sandbox_id: str) -> Any:
        client = self._get_docker_client()
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self._executor,
            lambda: client.containers.get(f"claudex-sandbox-{sandbox_id}"),
        )

    async def _destroy_container(self, container: Any) -> None:
        try:
            await asyncio.to_thread(container.stop, timeout=5)
        except Exception:
            pass
        try:
            await asyncio.to_thread(container.remove, force=True)
        except Exception:
            pass

    @staticmethod
    def _ensure_running(container: Any) -> None:
        container.reload()
        if container.status != "running":
            container.start()

    async def _get_container(self, sandbox_id: str) -> Any:
        if sandbox_id not in self._containers:
            connected = await self.connect_sandbox(sandbox_id)
            if not connected:
                raise SandboxException(f"Container {sandbox_id} not found")

        container = self._containers[sandbox_id]
        loop = asyncio.get_running_loop()

        await loop.run_in_executor(
            self._executor, lambda: self._ensure_running(container)
        )
        return container

    async def get_ide_url(self, sandbox_id: str) -> str | None:
        if self.config.sandbox_domain:
            subdomain = f"sandbox-{sandbox_id}-{self.config.openvscode_port}"
            return (
                f"https://{subdomain}.{self.config.sandbox_domain}/?folder=/home/user"
            )

        # If using HTTPS (remote deployment), use the proxy route
        if self.config.preview_base_url.startswith("https://"):
            # Extract the base URL without protocol for the proxy route
            base = self.config.preview_base_url.replace("https://", "").replace("http://", "")
            return f"https://{base}/api/v1/sandbox/{sandbox_id}/ide/?folder=/home/user"

        await self.connect_sandbox(sandbox_id)
        port_map = self._port_mappings.get(sandbox_id, {})
        host_port = port_map.get(self.config.openvscode_port)
        if not host_port:
            return None
        return f"{self.config.preview_base_url}:{host_port}/?folder=/home/user"

    async def get_vnc_url(self, sandbox_id: str) -> str | None:
        if self.config.sandbox_domain:
            subdomain = f"sandbox-{sandbox_id}-{VNC_WEBSOCKET_PORT}"
            return f"wss://{subdomain}.{self.config.sandbox_domain}"

        await self.connect_sandbox(sandbox_id)
        port_map = self._port_mappings.get(sandbox_id, {})
        host_port = port_map.get(VNC_WEBSOCKET_PORT)
        if not host_port:
            return None
        base_url = self.config.preview_base_url.replace("http://", "ws://").replace(
            "https://", "wss://"
        )
        return f"{base_url}:{host_port}"

    def _create_container_from_image(self, sandbox_id: str, image: Any) -> Any:
        client = self._get_docker_client()
        labels = self._build_traefik_labels(sandbox_id)
        network = self.config.traefik_network or self.config.network

        container = client.containers.run(
            image,
            command="/bin/bash",
            name=f"claudex-sandbox-{sandbox_id}",
            hostname="sandbox",
            user="user",
            working_dir=self.config.user_home,
            stdin_open=True,
            tty=True,
            detach=True,
            remove=False,
            privileged=True,
            security_opt=["no-new-privileges=false"],
            network=network,
            labels=labels,
            ports={
                **{f"{port}/tcp": None for port in DOCKER_AVAILABLE_PORTS},
                f"{self.config.openvscode_port}/tcp": None,
            },
            environment={
                "TERM": "xterm-256color",
                "HOME": self.config.user_home,
                "USER": "user",
                "OPENVSCODE_PORT": str(self.config.openvscode_port),
            },
        )
        return container

    async def clone_sandbox(
        self, source_sandbox_id: str, checkpoint_id: str | None = None
    ) -> str:
        loop = asyncio.get_running_loop()
        source_container = await self._get_container(source_sandbox_id)

        temp_image = await loop.run_in_executor(self._executor, source_container.commit)

        new_sandbox_id = str(uuid.uuid4())[:12]
        new_container: Any = None

        try:
            new_container = await loop.run_in_executor(
                self._executor,
                lambda: self._create_container_from_image(new_sandbox_id, temp_image),
            )
            self._containers[new_sandbox_id] = new_container

            port_map = await loop.run_in_executor(
                self._executor, lambda: self._extract_port_mappings(new_container)
            )
            self._port_mappings[new_sandbox_id] = port_map

            if checkpoint_id:
                await self.restore_checkpoint(new_sandbox_id, checkpoint_id)

            return new_sandbox_id
        except Exception:
            if new_sandbox_id in self._containers:
                del self._containers[new_sandbox_id]
            if new_sandbox_id in self._port_mappings:
                del self._port_mappings[new_sandbox_id]
            if new_container is not None:
                try:
                    await loop.run_in_executor(
                        self._executor, lambda: new_container.remove(force=True)
                    )
                except Exception:
                    pass
            raise
        finally:
            try:
                await loop.run_in_executor(
                    self._executor, lambda: temp_image.remove(force=True)
                )
            except Exception:
                pass

    async def cleanup(self) -> None:
        await super().cleanup()
        self._executor.shutdown(wait=False)
        if self._docker_client:
            self._docker_client.close()
            self._docker_client = None
