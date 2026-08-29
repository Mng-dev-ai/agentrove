#!/usr/bin/env python3

import asyncio
import os
import sys
from typing import Any

from browser_use.mcp.server import BrowserUseServer


class CloudBrowserUseServer(BrowserUseServer):
    async def _init_browser_session(
        self, allowed_domains: list[str] | None = None, **kwargs: Any
    ) -> None:
        # The upstream MCP server otherwise always creates a local browser profile.
        kwargs["use_cloud"] = True
        await super()._init_browser_session(allowed_domains=allowed_domains, **kwargs)


async def main() -> None:
    if not os.environ.get("BROWSER_USE_API_KEY"):
        print(
            "BROWSER_USE_API_KEY is required for cloud browser tools", file=sys.stderr
        )
        raise SystemExit(1)

    server = CloudBrowserUseServer()
    try:
        await server.run()
    finally:
        # Upstream keep_alive=True requires an explicit kill to stop cloud billing.
        if server.browser_session is not None:
            try:
                await server.browser_session.kill()
            except Exception as exc:
                print(f"Failed to stop cloud browser session: {exc}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
