import os
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from client import DEFAULT_API_URL, AgentroveClient, AgentroveError

mcp = FastMCP("agentrove")


def _build_client() -> AgentroveClient:
    email = os.environ.get("AGENTROVE_EMAIL")
    password = os.environ.get("AGENTROVE_PASSWORD")
    if not email or not password:
        raise AgentroveError("AGENTROVE_EMAIL and AGENTROVE_PASSWORD must be set")
    base_url = os.environ.get("AGENTROVE_API_URL", DEFAULT_API_URL)
    return AgentroveClient(base_url, email, password)


client = _build_client()


@mcp.tool()
async def list_workspaces() -> dict[str, Any]:
    """List the available AgentRove workspaces.

    Returns each workspace's id and name. Pass a workspace id as `workspace_id` to
    send_message to create a new chat in that workspace; otherwise the most recently
    active workspace is used.
    """
    workspaces = await client.list_workspaces()
    return {"workspaces": [{"id": w["id"], "name": w["name"]} for w in workspaces]}


@mcp.tool()
async def list_models(
    agent_kind: Literal["claude", "codex", "copilot", "cursor", "opencode"] | None = None,
) -> dict[str, Any]:
    """List available AI models, optionally filtered by agent_kind.

    Each entry has model_id, name and agent_kind. Pass a model_id as `model_id` to
    send_message to use it; otherwise a Claude model is used. An instance can expose
    many models, so filter by agent_kind to narrow the list.
    """
    models = await client.list_models(agent_kind)
    return {
        "models": [
            {"model_id": m["model_id"], "name": m["name"], "agent_kind": m["agent_kind"]}
            for m in models
        ]
    }


@mcp.tool()
async def list_chats(
    workspace_id: str | None = None,
    page: int = 1,
    per_page: int = 20,
) -> dict[str, Any]:
    """List existing chats for discovery, most recent first.

    Use a chat's id with send_message — as chat_id to continue it, or as parent_chat_id to
    add a sub-thread (only top-level chats, where parent_chat_id is null, can be parents).
    Filter by workspace_id to scope to one workspace. Returns id, title, workspace_id,
    parent_chat_id, sub_thread_count and updated_at, plus pagination.
    """
    data = await client.list_chats(workspace_id, page=page, per_page=per_page)
    chats = [
        {
            "id": c["id"],
            "title": c["title"],
            "workspace_id": c["workspace_id"],
            "parent_chat_id": c["parent_chat_id"],
            "sub_thread_count": c["sub_thread_count"],
            "updated_at": c["updated_at"],
        }
        for c in data["items"]
    ]
    return {
        "chats": chats,
        "page": data["page"],
        "pages": data["pages"],
        "total": data["total"],
    }


@mcp.tool()
async def list_personas() -> dict[str, Any]:
    """List custom personas available for send_message's `persona` argument.

    Returns each persona's name. Pass one as `persona` to send_message; if none are
    defined or `persona` is omitted, the standard "Default" persona is used.
    """
    personas = await client.list_personas()
    return {"personas": [{"name": p["name"]} for p in personas]}


@mcp.tool()
async def send_message(
    prompt: str,
    chat_id: str | None = None,
    parent_chat_id: str | None = None,
    title: str | None = None,
    workspace_id: str | None = None,
    model_id: str | None = None,
    thinking_mode: Literal["low", "medium", "high", "xhigh", "max"] | None = None,
    worktree: bool = False,
    plan_mode: bool = False,
    persona: str | None = None,
) -> dict[str, Any]:
    """Send a prompt to AgentRove and start the agent turn.

    Omit chat_id to create a new chat first (auto-resolving the workspace and a Claude
    model unless given, titled from `title` or the prompt) and send the prompt to it;
    pass chat_id to continue an existing chat. Set parent_chat_id (when creating) to make
    the new chat a sub-thread of that parent — it inherits the parent's workspace, and the
    parent must be a top-level chat (sub-threads can't nest).

    Per-turn options: thinking_mode sets reasoning effort (values not supported by the
    chosen model fall back to medium); worktree=true runs the turn in an isolated git
    worktree (its own branch); plan_mode=true runs a read-only planning turn; persona
    selects a custom persona by name (defaults to the standard persona).

    Returns immediately with chat_id and the streaming message_id. To get the reply, poll
    get_messages and watch that message's stream_status flip from "in_progress" to
    "completed". Permissions are bypassed so the turn runs unattended.
    """
    resolved_model = await client.resolve_model_id(model_id)
    if chat_id is None:
        resolved_workspace = await client.resolve_workspace_id(workspace_id)
        chat_title = (title or prompt[:60]).strip() or "New chat"
        chat = await client.create_chat(
            chat_title, resolved_workspace, resolved_model, parent_chat_id=parent_chat_id
        )
        chat_id = chat["id"]
    sent = await client.send_message(
        chat_id,
        prompt,
        resolved_model,
        permission_mode="bypassPermissions",
        thinking_mode=thinking_mode,
        worktree=worktree,
        plan_mode=plan_mode,
        persona=persona,
    )
    return {
        "chat_id": chat_id,
        "message_id": sent["message_id"],
        "status": "in_progress",
    }


@mcp.tool()
async def get_messages(
    chat_id: str,
    limit: int = 20,
    cursor: str | None = None,
) -> dict[str, Any]:
    """List messages in an AgentRove chat, oldest first.

    Returns up to `limit` messages (1-100) with role, content_text and stream_status.
    Use the returned next_cursor with a follow-up call to page through older messages.
    """
    page = await client.get_messages(chat_id, limit=limit, cursor=cursor)
    # Backend returns newest-first; flip to chronological for readability
    messages = [
        {
            "id": m["id"],
            "role": m["role"],
            "content": m["content_text"],
            "stream_status": m.get("stream_status"),
            "created_at": m["created_at"],
        }
        for m in reversed(page["items"])
    ]
    return {
        "messages": messages,
        "next_cursor": page["next_cursor"],
        "has_more": page["has_more"],
    }


if __name__ == "__main__":
    mcp.run()
