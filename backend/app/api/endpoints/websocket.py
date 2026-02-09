import asyncio
import errno
import json
import logging

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from app.actions.websocket import (
    AuthenticateTerminalUserAction,
    AuthenticatedTerminalUser,
    ResolveTerminalSandboxAccessAction,
)
from app.constants import (
    DEFAULT_PTY_COLS,
    DEFAULT_PTY_ROWS,
    WS_CLOSE_AUTH_FAILED,
    WS_MSG_AUTH,
    WS_MSG_CLOSE,
    WS_MSG_DETACH,
    WS_MSG_INIT,
    WS_MSG_PING,
    WS_MSG_RESIZE,
)
from app.core.config import get_settings
from app.db.session import SessionLocal

from app.services.terminal import terminal_session_registry

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)
authenticate_terminal_user_action = AuthenticateTerminalUserAction(SessionLocal)
resolve_terminal_sandbox_access_action = ResolveTerminalSandboxAccessAction(
    SessionLocal
)


async def wait_for_auth(
    websocket: WebSocket, timeout: float = 10.0
) -> AuthenticatedTerminalUser:
    try:
        message = await asyncio.wait_for(websocket.receive(), timeout=timeout)
    except asyncio.TimeoutError:
        return AuthenticatedTerminalUser(
            user=None,
            e2b_api_key=None,
            modal_api_key=None,
            sandbox_provider="docker",
        )

    if "text" not in message:
        return AuthenticatedTerminalUser(
            user=None,
            e2b_api_key=None,
            modal_api_key=None,
            sandbox_provider="docker",
        )

    try:
        data = json.loads(message["text"])
    except json.JSONDecodeError:
        return AuthenticatedTerminalUser(
            user=None,
            e2b_api_key=None,
            modal_api_key=None,
            sandbox_provider="docker",
        )

    if data.get("type") != WS_MSG_AUTH:
        return AuthenticatedTerminalUser(
            user=None,
            e2b_api_key=None,
            modal_api_key=None,
            sandbox_provider="docker",
        )

    token = data.get("token")
    if not token:
        return AuthenticatedTerminalUser(
            user=None,
            e2b_api_key=None,
            modal_api_key=None,
            sandbox_provider="docker",
        )

    return await authenticate_terminal_user_action.execute(token)


@router.websocket("/{sandbox_id}/terminal")
async def terminal_websocket(
    websocket: WebSocket,
    sandbox_id: str,
) -> None:
    await websocket.accept()

    auth_result = await wait_for_auth(websocket)
    if not auth_result.user:
        await websocket.close(code=WS_CLOSE_AUTH_FAILED, reason="Authentication failed")
        return

    sandbox_access = await resolve_terminal_sandbox_access_action.execute(
        sandbox_id=sandbox_id,
        user=auth_result.user,
        e2b_api_key=auth_result.e2b_api_key,
        modal_api_key=auth_result.modal_api_key,
        user_sandbox_provider=auth_result.sandbox_provider,
    )
    if sandbox_access.close_code and sandbox_access.close_reason:
        await websocket.close(
            code=sandbox_access.close_code,
            reason=sandbox_access.close_reason,
        )
        return

    provider_type = sandbox_access.provider_type
    if provider_type is None:
        logger.error("Missing provider type for sandbox_id=%s", sandbox_id)
        await websocket.close(code=WS_CLOSE_AUTH_FAILED, reason="Authentication failed")
        return

    terminal_id = websocket.query_params.get("terminalId") or "terminal-1"
    session = await terminal_session_registry.get_or_create(
        user_id=str(auth_result.user.id),
        sandbox_id=sandbox_id,
        terminal_id=terminal_id,
        provider_type=provider_type,
        api_key=sandbox_access.api_key,
    )

    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive(), timeout=30.0)
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": WS_MSG_PING}))
                continue

            if "bytes" in message:
                session.enqueue_input(message["bytes"])
                continue

            if "text" not in message:
                continue

            try:
                data = json.loads(message["text"])
            except json.JSONDecodeError:
                continue

            data_type = data.get("type")

            if data_type == WS_MSG_INIT:
                rows = int(data.get("rows") or DEFAULT_PTY_ROWS)
                cols = int(data.get("cols") or DEFAULT_PTY_COLS)

                size = await session.ensure_started(rows, cols)
                await session.attach(websocket)

                await websocket.send_text(
                    json.dumps(
                        {
                            "type": WS_MSG_INIT,
                            "id": session.pty_id,
                            "rows": size["rows"],
                            "cols": size["cols"],
                        }
                    )
                )

            elif data_type == WS_MSG_RESIZE:
                rows = int(data.get("rows") or 0)
                cols = int(data.get("cols") or 0)
                await session.resize(rows, cols)
            elif data_type == WS_MSG_CLOSE:
                await session.kill_tmux_session()
                await session.close()
                break
            elif data_type == WS_MSG_DETACH:
                await session.detach()
                break
    except WebSocketDisconnect:
        await session.detach()
    except Exception as e:
        logger.error("Error in terminal websocket: %s", e)
    finally:
        if session.active_websocket is websocket and session.pty_id:
            await session.detach()
        try:
            await websocket.close()
        except OSError as exc:
            if exc.errno != errno.EPIPE:
                logger.error("Failed to close websocket cleanly: %s", exc)
