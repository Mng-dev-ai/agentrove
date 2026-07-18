import os
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from client import DEFAULT_API_URL, AgentroveClient, AgentroveError

mcp = FastMCP("agentrove")

# Each agent's unattended (no-prompt, full-execution) session mode. The backend
# rejects modes that don't belong to the target agent (e.g. Codex only accepts
# auto/read-only/full-access), so the mode must match the model's agent kind.
# Canonical valid modes live in backend adapters.py (*_SESSION_MODES); this thin
# HTTP client can't import them, so the unattended tier is mirrored here.
PERMISSION_MODE_BY_AGENT = {
    "claude": "bypassPermissions",
    "codex": "full-access",
    "copilot": "autopilot",
    "cursor": "agent",
    "grok": "always-approve",
    "opencode": "build",
}


def _automation_summary(a: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": a["id"],
        "name": a["name"],
        "prompt": a["prompt"],
        "cron_expression": a["cron_expression"],
        "timezone": a["timezone"],
        "enabled": a["enabled"],
        "model_id": a["model_id"],
        "workspace_id": a["workspace_id"],
        "thinking_mode": a["thinking_mode"],
        "worktree": a["worktree"],
        "persona": a["selected_persona_name"],
        "next_run_at": a["next_run_at"],
        "last_run_at": a["last_run_at"],
    }


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
    agent_kind: Literal["claude", "codex", "copilot", "cursor", "grok", "opencode"] | None = None,
) -> dict[str, Any]:
    """List available AI models, optionally filtered by agent_kind.

    Each entry has model_id, name, agent_kind and thinking_modes — the reasoning-effort
    tiers the model accepts for send_message's thinking_mode, ordered lowest to highest
    (empty when the model has no reasoning dial; unsupported values fall back to medium).
    Pass a model_id as `model_id` to send_message to use it; otherwise a Claude model is
    used. An instance can expose many models, so filter by agent_kind to narrow the list.
    """
    models = await client.list_models(agent_kind)
    return {
        "models": [
            {
                "model_id": m["model_id"],
                "name": m["name"],
                "agent_kind": m["agent_kind"],
                "thinking_modes": m.get("thinking_modes", []),
            }
            for m in models
        ]
    }


@mcp.tool()
async def get_current_chat() -> dict[str, Any]:
    """Return the chat this MCP server is running inside, when known.

    Use its chat_id as send_message's parent_chat_id to create sub-threads under the
    current chat. Returns {"chat_id": null} if unknown (e.g. the server was launched
    standalone rather than for an AgentRove chat session).
    """
    return {"chat_id": os.environ.get("AGENTROVE_CURRENT_CHAT_ID")}


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
async def create_persona(name: str, content: str) -> dict[str, Any]:
    """Create a custom persona usable as send_message's `persona` argument.

    `name` is the unique label you'll pass as `persona` (it must not match an existing
    persona); `content` is the system prompt that shapes the agent's behavior for turns
    using this persona. Returns the created persona's name.
    """
    persona = await client.create_persona(name, content)
    return {"persona": {"name": persona["name"]}}


@mcp.tool()
async def update_persona(name: str, content: str) -> dict[str, Any]:
    """Replace an existing persona's system prompt.

    `name` must match an existing persona (see list_personas); `content` fully replaces
    its current system prompt. Chats already streaming keep the prompt they started with;
    new turns pick up the updated one. Returns the updated persona's name.
    """
    persona = await client.update_persona(name, content)
    return {"persona": {"name": persona["name"]}}


@mcp.tool()
async def delete_persona(name: str) -> dict[str, Any]:
    """Delete a custom persona permanently.

    `name` must match an existing persona (see list_personas). Chats that used it keep
    their history, but new turns can no longer select it. Returns {"deleted": true}.
    """
    await client.delete_persona(name)
    return {"deleted": True}


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
    fast_mode: bool = False,
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
    worktree (its own branch); fast_mode=true enables Codex's fast mode (ignored by
    non-Codex agents); persona selects a custom persona by name (defaults to the
    standard persona).

    Follow-up turns (chat_id given) inherit the chat's previous model_id, thinking_mode
    and persona when you omit them — pass a value only to change it for this turn.

    Returns immediately with chat_id and the streaming message_id. To get the reply, poll
    get_messages and watch that message's stream_status flip from "in_progress" to
    "completed". The turn runs unattended — it uses the model's full-execution permission
    mode (e.g. bypassPermissions for Claude, full-access for Codex).
    """
    if chat_id is not None:
        # Follow-up: default omitted settings to the chat's previous turn so a
        # bare send_message(chat_id=...) continues with the same model/persona/
        # effort instead of silently switching to the global defaults.
        chat = await client.get_chat(chat_id)
        model_id = model_id or chat.get("last_model_id")
        thinking_mode = thinking_mode or chat.get("last_thinking_mode")
        persona = persona or chat.get("last_persona_name")
    resolved_model, agent_kind = await client.resolve_model(model_id)
    permission_mode = PERMISSION_MODE_BY_AGENT[agent_kind]
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
        permission_mode=permission_mode,
        thinking_mode=thinking_mode,
        worktree=worktree,
        fast_mode=fast_mode,
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


@mcp.tool()
async def list_automations() -> dict[str, Any]:
    """List your scheduled automations.

    Each automation runs its prompt on a cron schedule, starting a new unattended chat
    every time it fires. Returns id, name, cron_expression, timezone, enabled, model_id,
    workspace_id and the next_run_at / last_run_at timestamps. Use an id with
    update_automation, delete_automation or run_automation.
    """
    automations = await client.list_automations()
    return {"automations": [_automation_summary(a) for a in automations]}


@mcp.tool()
async def create_automation(
    name: str,
    prompt: str,
    cron_expression: str,
    timezone: str = "UTC",
    workspace_id: str | None = None,
    model_id: str | None = None,
    thinking_mode: Literal["low", "medium", "high", "xhigh", "max"] | None = None,
    worktree: bool = False,
    persona: str | None = None,
    enabled: bool = True,
) -> dict[str, Any]:
    """Create a scheduled automation that runs a prompt on a cron schedule.

    Each time the schedule fires, AgentRove starts a new unattended chat and sends the
    prompt using the model's full-execution permission mode (e.g. bypassPermissions for
    Claude, full-access for Codex). cron_expression is a standard 5-field cron string
    evaluated in `timezone` (an IANA name like "America/New_York"). Omit model_id to use
    a Claude model and workspace_id to use the most recently active workspace. Per-run
    options (thinking_mode, worktree, persona) match send_message. Set
    enabled=false to create it paused.

    Returns the created automation, including its id and next_run_at.
    """
    resolved_model, agent_kind = await client.resolve_model(model_id)
    resolved_workspace = await client.resolve_workspace_id(workspace_id)
    body: dict[str, Any] = {
        "name": name,
        "prompt": prompt,
        "cron_expression": cron_expression,
        "timezone": timezone,
        "workspace_id": resolved_workspace,
        "model_id": resolved_model,
        "permission_mode": PERMISSION_MODE_BY_AGENT[agent_kind],
        "worktree": worktree,
        "enabled": enabled,
    }
    if thinking_mode:
        body["thinking_mode"] = thinking_mode
    if persona:
        body["selected_persona_name"] = persona
    automation = await client.create_automation(body)
    return {"automation": _automation_summary(automation)}


@mcp.tool()
async def update_automation(
    automation_id: str,
    name: str | None = None,
    prompt: str | None = None,
    cron_expression: str | None = None,
    timezone: str | None = None,
    workspace_id: str | None = None,
    model_id: str | None = None,
    thinking_mode: Literal["low", "medium", "high", "xhigh", "max"] | None = None,
    worktree: bool | None = None,
    persona: str | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    """Update an existing automation; only the arguments you pass are changed.

    Pass model_id to switch models (its permission mode is updated to match), enabled to
    pause/resume, or cron_expression/timezone to reschedule (next_run_at is recomputed).
    Returns the updated automation.
    """
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if prompt is not None:
        body["prompt"] = prompt
    if cron_expression is not None:
        body["cron_expression"] = cron_expression
    if timezone is not None:
        body["timezone"] = timezone
    if workspace_id is not None:
        body["workspace_id"] = workspace_id
    if model_id is not None:
        resolved_model, agent_kind = await client.resolve_model(model_id)
        body["model_id"] = resolved_model
        body["permission_mode"] = PERMISSION_MODE_BY_AGENT[agent_kind]
    if thinking_mode is not None:
        body["thinking_mode"] = thinking_mode
    if worktree is not None:
        body["worktree"] = worktree
    if persona is not None:
        body["selected_persona_name"] = persona
    if enabled is not None:
        body["enabled"] = enabled
    automation = await client.update_automation(automation_id, body)
    return {"automation": _automation_summary(automation)}


@mcp.tool()
async def delete_automation(automation_id: str) -> dict[str, Any]:
    """Delete a scheduled automation permanently. Returns {"deleted": true}."""
    await client.delete_automation(automation_id)
    return {"deleted": True}


@mcp.tool()
async def run_automation(automation_id: str) -> dict[str, Any]:
    """Trigger an automation immediately, without waiting for its schedule.

    Starts a new unattended chat with the automation's prompt right now; the regular cron
    schedule (next_run_at) is unaffected. Returns the chat_id of the new chat — poll
    get_messages on it to read the reply.
    """
    result = await client.run_automation(automation_id)
    return {"chat_id": result["chat_id"]}


if __name__ == "__main__":
    mcp.run()
