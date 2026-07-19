import asyncio
import errno
import json
import logging

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from app.constants import (
    DEFAULT_PTY_COLS,
    DEFAULT_PTY_ROWS,
    DEFAULT_TERMINAL_ID,
    WS_CLOSE_AUTH_FAILED,
    WS_CLOSE_INVALID_CWD,
    WS_MSG_CLOSE,
    WS_MSG_DETACH,
    WS_MSG_INIT,
    WS_MSG_PING,
    WS_MSG_REFRESH,
    WS_MSG_RESIZE,
)
from app.core.security import (
    resolve_websocket_sandbox_access,
    wait_for_websocket_auth,
)
from app.services.terminal import terminal_session_registry
from app.utils.parsing import parse_pty_dimension
from app.utils.sandbox import normalize_relative_path

router = APIRouter()
logger = logging.getLogger(__name__)

WS_RECEIVE_TIMEOUT_SECONDS = 30.0


@router.websocket("/{sandbox_id}/terminal")
async def terminal_websocket(
    websocket: WebSocket,
    sandbox_id: str,
) -> None:
    # After accept: first frame = auth; then raw PTY stdin or JSON control
    # (init/refresh/resize/close/detach). 30s receive timeout → keepalive ping.
    await websocket.accept()

    user = await wait_for_websocket_auth(websocket)
    if not user:
        await websocket.close(code=WS_CLOSE_AUTH_FAILED, reason="Authentication failed")
        return

    access = await resolve_websocket_sandbox_access(websocket, sandbox_id, user)
    if access is None:
        return
    provider_type, workspace_path = access

    # worktree_cwd lands the shell in a worktree-backed chat's tree, not root.
    try:
        cwd = normalize_relative_path(websocket.query_params.get("cwd"))
    except ValueError:
        await websocket.close(code=WS_CLOSE_INVALID_CWD, reason="Invalid terminal cwd")
        return

    terminal_id = websocket.query_params.get("terminalId") or DEFAULT_TERMINAL_ID
    session = await terminal_session_registry.get_or_create(
        user_id=str(user.id),
        sandbox_id=sandbox_id,
        terminal_id=terminal_id,
        cwd=cwd,
        provider_type=provider_type,
        workspace_path=workspace_path,
    )

    try:
        while True:
            try:
                message = await asyncio.wait_for(
                    websocket.receive(), timeout=WS_RECEIVE_TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                try:
                    await websocket.send_text(json.dumps({"type": WS_MSG_PING}))
                except (RuntimeError, OSError):
                    # Dead peer: break so finally detaches instead of raising.
                    break
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

            if not isinstance(data, dict):
                continue

            data_type = data.get("type")
            if not data_type:
                continue

            if data_type == WS_MSG_INIT:
                rows = parse_pty_dimension(
                    data.get("rows"),
                    default=DEFAULT_PTY_ROWS,
                    min_value=1,
                    max_value=500,
                )
                cols = parse_pty_dimension(
                    data.get("cols"),
                    default=DEFAULT_PTY_COLS,
                    min_value=1,
                    max_value=500,
                )

                await session.ensure_started(rows, cols)
                await session.attach(websocket)

                await websocket.send_text(
                    json.dumps(
                        {
                            "type": WS_MSG_INIT,
                            "id": session.pty_id,
                            "rows": rows,
                            "cols": cols,
                        }
                    )
                )

            elif data_type == WS_MSG_REFRESH:
                # Client-driven repaint once xterm is sized (not at init — race
                # with reconnect). Via tmux, not pane stdin (TUI would swallow keys).
                await session.refresh_tmux_client()

            elif data_type == WS_MSG_RESIZE:
                rows = parse_pty_dimension(
                    data.get("rows"),
                    default=0,
                    min_value=0,
                    max_value=500,
                )
                cols = parse_pty_dimension(
                    data.get("cols"),
                    default=0,
                    min_value=0,
                    max_value=500,
                )
                if rows > 0 and cols > 0:
                    await session.resize(rows, cols)
            elif data_type == WS_MSG_CLOSE:
                await session.terminate()
                break
            elif data_type == WS_MSG_DETACH:
                break
    except WebSocketDisconnect:
        pass
    finally:
        if session.active_websocket is websocket:
            await session.detach()
        try:
            await websocket.close()
        except RuntimeError:
            # Already closed (attach takeover / PTY exit); second close raises.
            pass
        except OSError as exc:
            if exc.errno != errno.EPIPE:
                logger.error("Failed to close websocket cleanly: %s", exc)
