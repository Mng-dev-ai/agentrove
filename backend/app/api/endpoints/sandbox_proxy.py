import asyncio
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from app.core.deps import (
    SandboxContext,
    get_sandbox_context,
    get_sandbox_service_for_context,
)
from app.services.sandbox import SandboxService

logger = logging.getLogger(__name__)

router = APIRouter()

# OpenVSCode Server port inside sandbox containers
OPENVSCODE_PORT = 8765


async def get_sandbox_container_ip(
    sandbox_id: str,
    sandbox_service: SandboxService,
) -> str | None:
    """Get the IP address of a sandbox container on the Docker network."""
    provider = sandbox_service.provider

    # Ensure sandbox is connected
    await provider.connect_sandbox(sandbox_id)

    if sandbox_id not in provider._containers:
        return None

    container = provider._containers[sandbox_id]
    loop = asyncio.get_running_loop()

    def get_ip() -> str | None:
        container.reload()
        networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})
        if not networks:
            return None
        # Get the first network's IP (usually the network the container is on)
        for network_name, network_info in networks.items():
            ip = network_info.get("IPAddress")
            if ip:
                return ip
        return None

    return await loop.run_in_executor(provider._executor, get_ip)


@router.api_route(
    "/{sandbox_id}/ide/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]
)
async def proxy_ide_http(
    path: str,
    request: Request,
    context: SandboxContext = Depends(get_sandbox_context),
    sandbox_service: SandboxService = Depends(get_sandbox_service_for_context),
) -> Response:
    """Proxy HTTP requests to the sandbox's OpenVSCode Server."""
    container_ip = await get_sandbox_container_ip(context.sandbox_id, sandbox_service)
    if not container_ip:
        return Response(status_code=503, content="Sandbox not available")

    target_url = f"http://{container_ip}:{OPENVSCODE_PORT}/{path}"

    # Build query string
    query_str = str(request.url.query)
    if query_str:
        target_url += f"?{query_str}"

    # Read request body
    body = await request.body()

    # Build headers, excluding hop-by-hop headers
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("connection", None)
    headers.pop("keep-alive", None)
    # Update host header to target
    headers["host"] = f"{container_ip}:{OPENVSCODE_PORT}"

    try:
        async with httpx.AsyncClient() as client:
            proxy_response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                timeout=300.0,
                follow_redirects=True,
            )

            # Build response headers
            response_headers = dict(proxy_response.headers)
            response_headers.pop("transfer-encoding", None)
            response_headers.pop("connection", None)
            response_headers.pop("keep-alive", None)

            return Response(
                content=proxy_response.content,
                status_code=proxy_response.status_code,
                headers=response_headers,
            )
    except httpx.ConnectError:
        return Response(status_code=503, content="Failed to connect to sandbox IDE")
    except httpx.TimeoutException:
        return Response(status_code=504, content="Sandbox IDE timeout")
    except Exception as e:
        logger.error(f"Proxy error: {e}")
        return Response(status_code=500, content="Internal proxy error")


@router.websocket("/{sandbox_id}/ide/{path:path}")
async def proxy_ide_websocket(
    path: str,
    websocket: WebSocket,
    context: SandboxContext = Depends(get_sandbox_context),
    sandbox_service: SandboxService = Depends(get_sandbox_service_for_context),
) -> None:
    """Proxy WebSocket connections to the sandbox's OpenVSCode Server."""
    await websocket.accept()

    container_ip = await get_sandbox_container_ip(context.sandbox_id, sandbox_service)
    if not container_ip:
        await websocket.close(code=1011, reason="Sandbox not available")
        return

    target_url = f"ws://{container_ip}:{OPENVSCODE_PORT}/{path}"
    query_str = str(websocket.url.query)
    if query_str:
        target_url += f"?{query_str}"

    try:
        import websockets

        # Connect to target WebSocket
        async with websockets.connect(
            target_url,
            max_size=10 * 1024 * 1024,  # 10MB max message size
            ping_timeout=None,
        ) as target_ws:
            # Create tasks for bidirectional forwarding
            async def forward_to_target():
                try:
                    while True:
                        data = await websocket.receive_text()
                        if isinstance(data, str):
                            await target_ws.send(data)
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    logger.debug(f"Client disconnect: {e}")

            async def forward_to_client():
                try:
                    async for message in target_ws:
                        await websocket.send_text(message)
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    logger.debug(f"Target disconnect: {e}")

            # Run both forwarding tasks
            await asyncio.gather(
                forward_to_target(),
                forward_to_client(),
                return_exceptions=True,
            )

    except ImportError:
        await websocket.close(code=1011, reason="WebSocket library not available")
        logger.error("websockets library not installed")
    except Exception as e:
        logger.error(f"WebSocket proxy error: {e}")
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception:
            pass
