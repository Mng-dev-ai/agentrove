from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Coroutine

PtyDataCallbackType = Callable[[bytes], Coroutine[Any, Any, None]]
# Sync on purpose — fired from inside the provider's reader task, so handlers
# must schedule their own async work rather than be awaited there.
PtyExitCallbackType = Callable[[], None]


class SandboxProviderType(str, Enum):
    DOCKER = "docker"
    HOST = "host"


@dataclass
class CommandResult:
    stdout: str
    stderr: str
    exit_code: int


@dataclass
class FileMetadata:
    path: str
    type: str
    is_binary: bool = False


@dataclass
class FileContent:
    path: str
    content: str
    type: str
    is_binary: bool


@dataclass
class PtySize:
    rows: int
    cols: int
