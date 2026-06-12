from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Coroutine

PtyDataCallbackType = Callable[[bytes], Coroutine[Any, Any, None]]


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
