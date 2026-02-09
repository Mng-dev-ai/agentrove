import json

from fastapi import HTTPException, status

from app.core.security import validate_chat_scoped_token
from app.models.schemas import PermissionResult


def validate_token_for_chat(authorization: str, chat_id: str) -> None:
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header",
        )

    token = authorization.replace("Bearer ", "")
    if not validate_chat_scoped_token(token, chat_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired token for this chat",
        )


def parse_response_payload(raw_payload: str) -> PermissionResult:
    try:
        data: dict[str, object] = json.loads(raw_payload)
        return PermissionResult.model_validate(data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid response payload",
        ) from exc
