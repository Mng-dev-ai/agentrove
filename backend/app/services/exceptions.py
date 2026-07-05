from enum import Enum


class ErrorCode(str, Enum):
    UNKNOWN_ERROR = "UNKNOWN_ERROR"
    CHAT_NOT_FOUND = "CHAT_NOT_FOUND"
    CHAT_ACCESS_DENIED = "CHAT_ACCESS_DENIED"
    MESSAGE_NOT_FOUND = "MESSAGE_NOT_FOUND"
    USER_NOT_FOUND = "USER_NOT_FOUND"
    AUTH_INVALID_TOKEN = "AUTH_INVALID_TOKEN"
    SANDBOX_CREATE_FAILED = "SANDBOX_CREATE_FAILED"
    SANDBOX_OPERATION_FAILED = "SANDBOX_OPERATION_FAILED"
    STORAGE_FILE_NOT_FOUND = "STORAGE_FILE_NOT_FOUND"
    AI_SERVICE_ERROR = "AI_SERVICE_ERROR"
    API_KEY_MISSING = "API_KEY_MISSING"
    WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND"
    AUTOMATION_NOT_FOUND = "AUTOMATION_NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    GITHUB_TOKEN_INVALID = "GITHUB_TOKEN_INVALID"
    GITHUB_API_FAILED = "GITHUB_API_FAILED"


class ServiceException(Exception):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
        details: dict[str, str] | None = None,
        status_code: int = 500,
    ):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.details: dict[str, str] = details or {}
        self.status_code = status_code


class ChatException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.CHAT_NOT_FOUND,
        details: dict[str, str] | None = None,
        status_code: int = 400,
    ):
        super().__init__(message, error_code, details, status_code)


class MessageException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.MESSAGE_NOT_FOUND,
        details: dict[str, str] | None = None,
        status_code: int = 400,
    ):
        super().__init__(message, error_code, details, status_code)


class UserException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.USER_NOT_FOUND,
        details: dict[str, str] | None = None,
        status_code: int = 400,
    ):
        super().__init__(message, error_code, details, status_code)


class SandboxException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.SANDBOX_OPERATION_FAILED,
        details: dict[str, str] | None = None,
        status_code: int = 400,
    ):
        super().__init__(message, error_code, details, status_code)


class StorageException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.STORAGE_FILE_NOT_FOUND,
        details: dict[str, str] | None = None,
        status_code: int = 400,
    ):
        super().__init__(message, error_code, details, status_code)


class AgentException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.AI_SERVICE_ERROR,
        details: dict[str, str] | None = None,
        status_code: int = 400,
    ):
        super().__init__(message, error_code, details, status_code)


class AuthException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.AUTH_INVALID_TOKEN,
        details: dict[str, str] | None = None,
        status_code: int = 401,
    ):
        super().__init__(message, error_code, details, status_code)


class GitHubException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.GITHUB_API_FAILED,
        details: dict[str, str] | None = None,
        status_code: int = 502,
    ):
        super().__init__(message, error_code, details, status_code)


class AttachmentException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.STORAGE_FILE_NOT_FOUND,
        details: dict[str, str] | None = None,
        status_code: int = 400,
    ):
        super().__init__(message, error_code, details, status_code)


class WorkspaceException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.WORKSPACE_NOT_FOUND,
        details: dict[str, str] | None = None,
        status_code: int = 400,
    ):
        super().__init__(message, error_code, details, status_code)


class AutomationException(ServiceException):
    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.AUTOMATION_NOT_FOUND,
        details: dict[str, str] | None = None,
        status_code: int = 400,
    ):
        super().__init__(message, error_code, details, status_code)
