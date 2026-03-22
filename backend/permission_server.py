#!/usr/bin/env python3
import asyncio
import json
import os

import httpx
import mcp.server.stdio
import mcp.types as types
from mcp.server.lowlevel import NotificationOptions, Server
from mcp.server.models import InitializationOptions

server = Server("permission")

PERMISSION_MODE = os.environ.get("PERMISSION_MODE", "plan")
API_BASE_URL = os.environ.get("API_BASE_URL")
CHAT_TOKEN = os.environ.get("CHAT_TOKEN")
CHAT_ID = os.environ.get("CHAT_ID")
PLAN_MODE_TOOLS = ("EnterPlanMode", "ExitPlanMode")
USER_INTERACTION_TOOLS = ("AskUserQuestion",)
AUTO_APPROVE_MODES = ("plan", "auto")


@server.list_tools()
async def handle_list_tools() -> list[types.Tool]:
    description = (
        "Handles permission requests for tool usage. "
        "In plan mode, auto-approves all tools. "
        "In ask mode, requests user approval via UI."
        "In auto mode, requests user approval for plan mode tools and auto-approves others."
    )

    return [
        types.Tool(
            name="approval_prompt",
            description=description,
            inputSchema={
                "type": "object",
                "properties": {
                    "tool_name": {
                        "type": "string",
                        "description": "The name of the tool to approve",
                    },
                    "input": {
                        "type": "object",
                        "description": "The input parameters for the tool",
                    },
                },
                "required": ["tool_name", "input"],
            },
        )
    ]


@server.call_tool()
async def handle_call_tool(
    name: str, arguments: dict | None
) -> list[types.TextContent]:
    if name != "approval_prompt":
        raise ValueError(f"Unknown tool: {name}")

    if not arguments:
        raise ValueError("Missing arguments")

    tool_name = arguments.get("tool_name", "unknown")
    tool_input = arguments.get("input", {})

    requires_user_interaction = (
        tool_name in PLAN_MODE_TOOLS or tool_name in USER_INTERACTION_TOOLS
    )

    if PERMISSION_MODE in AUTO_APPROVE_MODES and not requires_user_interaction:
        response = {"behavior": "allow", "updatedInput": tool_input}
        return [types.TextContent(type="text", text=json.dumps(response))]

    # Auto mode is fully autonomous: deny AskUserQuestion so the agent never waits
    # for user input, and allow plan-mode transitions freely so the agent can plan
    # and execute without interruption.
    if PERMISSION_MODE == "auto":
        if tool_name in USER_INTERACTION_TOOLS:
            response = {
                "behavior": "deny",
                "message": "Autonomous mode: proceed without asking the user.",
            }
        else:
            response = {"behavior": "allow", "updatedInput": tool_input}
        return [types.TextContent(type="text", text=json.dumps(response))]

    should_request_approval = PERMISSION_MODE == "ask" or requires_user_interaction
    if should_request_approval:
        if not API_BASE_URL or not CHAT_TOKEN or not CHAT_ID:
            response = {
                "behavior": "deny",
                "message": "Permission server not properly configured for ask mode",
            }
            return [types.TextContent(type="text", text=json.dumps(response))]

        try:
            async with httpx.AsyncClient(timeout=310.0) as client:
                headers = {
                    "Authorization": f"Bearer {CHAT_TOKEN}",
                    "Content-Type": "application/json",
                }

                create_response = await client.post(
                    f"{API_BASE_URL}/api/v1/chats/{CHAT_ID}/permissions/request",
                    json={"tool_name": tool_name, "tool_input": tool_input},
                    headers=headers,
                )

                if create_response.status_code != 200:
                    detail = create_response.text[:200]
                    response = {
                        "behavior": "deny",
                        "message": f"Failed to create permission request: {create_response.status_code} - {detail}",
                    }
                    return [types.TextContent(type="text", text=json.dumps(response))]

                request_data = create_response.json()
                request_id = request_data["request_id"]

                get_response = await client.get(
                    f"{API_BASE_URL}/api/v1/chats/{CHAT_ID}/permissions/response/{request_id}",
                    headers=headers,
                )

                if get_response.status_code == 408:
                    response = {
                        "behavior": "deny",
                        "message": "Permission request timed out",
                    }
                    return [types.TextContent(type="text", text=json.dumps(response))]

                if get_response.status_code != 200:
                    detail = get_response.text[:200]
                    response = {
                        "behavior": "deny",
                        "message": f"Failed to get permission response: {get_response.status_code} - {detail}",
                    }
                    return [types.TextContent(type="text", text=json.dumps(response))]

                result_data = get_response.json()
                approved = result_data.get("approved", False)
                alternative_instruction = result_data.get("alternative_instruction")
                user_answers = result_data.get("user_answers")

                if approved:
                    if user_answers is not None and tool_name == "AskUserQuestion":
                        string_answers = {}
                        for key, value in user_answers.items():
                            string_answers[key] = (
                                ", ".join(value) if isinstance(value, list) else value
                            )
                        response = {
                            "behavior": "allow",
                            "updatedInput": {**tool_input, "answers": string_answers},
                        }
                    elif user_answers is not None:
                        response = {
                            "behavior": "allow",
                            "updatedInput": tool_input,
                            "message": f"User provided answers: {json.dumps(user_answers)}",
                        }
                    else:
                        response = {"behavior": "allow", "updatedInput": tool_input}
                else:
                    message = "User denied permission"
                    if alternative_instruction:
                        message = (
                            f"User provided alternative: {alternative_instruction}"
                        )
                    response = {"behavior": "deny", "message": message}

                return [types.TextContent(type="text", text=json.dumps(response))]

        except httpx.RequestError:
            response = {
                "behavior": "deny",
                "message": "Permission request failed: Network error",
            }
            return [types.TextContent(type="text", text=json.dumps(response))]
        except Exception as e:
            response = {
                "behavior": "deny",
                "message": f"Permission request failed: {str(e)}",
            }
            return [types.TextContent(type="text", text=json.dumps(response))]

    response = {
        "behavior": "deny",
        "message": f"Unknown permission mode: {PERMISSION_MODE}",
    }
    return [types.TextContent(type="text", text=json.dumps(response))]


async def main() -> None:
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="permission",
                server_version="1.0.0",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )


if __name__ == "__main__":
    asyncio.run(main())
