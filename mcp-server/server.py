import functools
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from pydantic import BaseModel, Field
from starlette.types import Receive, Scope, Send

from client import DEFAULT_API_URL, AgentroveClient, AgentroveError, ChatBusyError

mcp = FastMCP("agentrove")

# Unattended full-execution mode per agent. Backend rejects cross-agent modes;
# mirrored here because this HTTP client can't import adapters.*_SESSION_MODES.
PERMISSION_MODE_BY_AGENT = {
    "antigravity": "yolo",
    "claude": "bypassPermissions",
    "codex": "full-access",
    "copilot": "autopilot",
    "cursor": "agent",
    "grok": "always-approve",
    "opencode": "build",
}


class ChannelMember(BaseModel):
    model_id: str
    display_name: str | None = Field(None, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")
    persona: str | None = None
    thinking_mode: Literal["low", "medium", "high", "xhigh", "max"] | None = None


def _channel_summary(channel: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": channel["id"],
        "name": channel["name"],
        "workspace_id": channel["workspace_id"],
        "worktree": channel["worktree"],
        "branch": channel["branch"],
        "created_at": channel["created_at"],
        "updated_at": channel["updated_at"],
        "members": [
            {
                "id": member["id"],
                "chat_id": member["chat_id"],
                "display_name": member["display_name"],
                "model_id": member["model_id"],
                "persona": member["persona"],
                "thinking_mode": member["thinking_mode"],
            }
            for member in channel["members"]
        ],
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
        "channel_id": a.get("channel_id"),
        "thinking_mode": a["thinking_mode"],
        "worktree": a["worktree"],
        "persona": a["selected_persona_name"],
        "next_run_at": a["next_run_at"],
        "last_run_at": a["last_run_at"],
    }


def _require_channel_target(automation: dict[str, Any]) -> None:
    if automation.get("channel_id") is None:
        raise AgentroveError(
            "This backend does not support channel targets; automation "
            f"{automation['id']} was saved without one and starts a new chat per run."
        )


@functools.cache
def _env_client() -> AgentroveClient:
    # The backend mints a per-user token for the chat's owner at session spawn.
    access_token = os.environ.get("AGENTROVE_ACCESS_TOKEN")
    if not access_token:
        raise AgentroveError("AGENTROVE_ACCESS_TOKEN must be set")
    base_url = os.environ.get("AGENTROVE_API_URL", DEFAULT_API_URL)
    return AgentroveClient(base_url, access_token)


def _session() -> tuple[AgentroveClient, str | None]:
    """The API client and current chat id for this tool call.

    Over HTTP they come from the request (see HttpEndpoint); over stdio, from the
    env vars the backend sets when it spawns this process.
    """
    request = mcp.get_context().request_context.request
    if request is None:
        return _env_client(), os.environ.get("AGENTROVE_CURRENT_CHAT_ID")
    return request.state.agentrove_client, request.state.agentrove_chat_id


class _SandboxClient(AgentroveClient):
    async def attach_file(self, chat_id: str, path: str) -> dict[str, Any]:
        # HTTP callers are Docker sandbox agents: the file lives in their sandbox,
        # not on the backend's filesystem.
        resp = await self.request(
            "POST",
            f"/chat/chats/{chat_id}/attachments/sandbox",
            json={"path": path},
            expected=(201,),
        )
        return resp.json()


class HttpEndpoint:
    """ASGI app serving these tools over stateless streamable HTTP in the backend.

    The backend's McpAuthMiddleware authenticates the sandbox first and puts a
    short-lived token scoped to the sandbox's workspace, plus the current chat id,
    in the ASGI scope state; tool calls reach the REST API at api_url with that
    token. Request headers are never trusted for either.
    """

    def __init__(self, api_url: str) -> None:
        self._api_url = api_url
        self._session_manager: StreamableHTTPSessionManager | None = None

    @asynccontextmanager
    async def run(self) -> AsyncIterator[None]:
        # A session manager runs only once and FastMCP memoizes its own, so each
        # app lifespan gets a fresh one.
        self._session_manager = StreamableHTTPSessionManager(
            app=mcp._mcp_server, json_response=True, stateless=True
        )
        async with self._session_manager.run():
            yield

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self._session_manager is None:
            raise RuntimeError("HttpEndpoint.run() must be active to serve requests")
        # Request.state is scope["state"], which the transport hands to tools.
        state = scope["state"]
        client = _SandboxClient(self._api_url, state["agentrove_token"])
        state["agentrove_client"] = client
        try:
            await self._session_manager.handle_request(scope, receive, send)
        finally:
            await client.aclose()


@mcp.tool()
async def list_workspaces() -> dict[str, Any]:
    """List the available AgentRove workspaces.

    Returns each workspace's id and name. Pass a workspace id as `workspace_id` to
    send_message to create a new chat in that workspace; otherwise the most recently
    active workspace is used.
    """
    client, _ = _session()
    workspaces = await client.list_workspaces()
    return {"workspaces": [{"id": w["id"], "name": w["name"]} for w in workspaces]}


@mcp.tool()
async def list_models(
    agent_kind: Literal[
        "antigravity", "claude", "codex", "copilot", "cursor", "grok", "opencode"
    ]
    | None = None,
) -> dict[str, Any]:
    """List available AI models, optionally filtered by agent_kind.

    Each entry has model_id, name, agent_kind and thinking_modes — the reasoning-effort
    tiers the model accepts for send_message's thinking_mode, ordered lowest to highest
    (empty when the model has no reasoning dial; unsupported values fall back to medium).
    Pass a model_id as `model_id` to send_message to use it; otherwise a Claude model is
    used. An instance can expose many models, so filter by agent_kind to narrow the list.
    """
    client, _ = _session()
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
    _, chat_id = _session()
    return {"chat_id": chat_id}


@mcp.tool()
async def attach_file(path: str) -> dict[str, Any]:
    """Attach a local file to the current assistant message for the user to view or download.

    Use this for screenshots and other output files the user should see. Supported
    types: PNG, JPEG, GIF, WebP, PDF and XLSX, up to 5 MB. Accepts an absolute path (including /tmp) or a path relative to the session's
    working directory. The file is copied into chat storage and remains available
    after the sandbox is deleted. Requires an active turn in an AgentRove chat.
    """
    client, chat_id = _session()
    if not chat_id:
        raise AgentroveError("attach_file requires an AgentRove chat session")
    return await client.attach_file(chat_id, path)


@mcp.tool()
async def notify_user(title: str, body: str) -> dict[str, Any]:
    """Send the user a message in their AgentRove Inbox (and a push notification when enabled).

    Use it only for something unexpected the user should know before this turn ends
    (a bug or security issue, a blocker needing their input, a finding that changes the
    plan, a consequential decision made on their behalf). Not for progress or expected
    outcomes (pushed, opened a PR, CI passed, done): the final reply already triggers a
    completion push. Title is 1-80 characters, body 1-500.
    Returns the created item.
    """
    client, chat_id = _session()
    if not chat_id:
        raise AgentroveError("notify_user requires an AgentRove chat session")
    return await client.notify_user(chat_id, title, body)


def _memory_summary(memory: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": memory["id"],
        "scope": "global" if memory["workspace_id"] is None else "workspace",
        "title": memory["title"],
        "content": memory["content"],
    }


async def _current_workspace_id() -> str | None:
    client, chat_id = _session()
    return (await client.get_chat(chat_id))["workspace_id"] if chat_id else None


@mcp.tool()
async def remember(
    title: str,
    content: str,
    scope: Literal["workspace", "global"] | None = None,
    memory_id: str | None = None,
) -> str:
    """Save a durable fact to the AgentRove memory shared by every agent and chat.

    Only for preferences, corrections, conventions and environment facts — not task
    progress. Search first and pass memory_id to update an existing memory instead of
    adding a duplicate. scope "workspace" ties it to this chat's workspace, "global"
    applies everywhere; new memories default to "workspace", and updates keep the
    existing scope unless scope is given. Title is 1-80 characters on one line,
    content 1-500. Returns the memory id.
    """
    client, chat_id = _session()
    if scope is None and memory_id is None:
        scope = "workspace"
    body: dict[str, Any] = {"title": title, "content": content}
    if chat_id:
        body["chat_id"] = chat_id
    if scope == "workspace":
        workspace_id = await _current_workspace_id()
        if workspace_id is None:
            raise AgentroveError(
                "remember with scope 'workspace' requires an AgentRove chat session"
            )
        body["workspace_id"] = workspace_id
    elif scope == "global":
        body["workspace_id"] = None
    if memory_id:
        memory = await client.update_memory(memory_id, body)
    else:
        memory = await client.create_memory(body)
    return memory["id"]


@mcp.tool()
async def search_memory(query: str) -> list[dict[str, Any]]:
    """Search the shared AgentRove memory (case-insensitive; every word must match).

    Covers this chat's workspace plus global memories. Pass an empty query to list
    them all. Returns id, scope, title and content, pinned first, newest first.
    """
    client, _ = _session()
    workspace_id = await _current_workspace_id()
    return [_memory_summary(m) for m in await client.search_memories(query, workspace_id)]


@mcp.tool()
async def forget(memory_id: str) -> dict[str, Any]:
    """Delete a memory from the shared AgentRove memory, e.g. one that turned out wrong."""
    client, _ = _session()
    await client.delete_memory(memory_id)
    return {"deleted": True}


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
    client, _ = _session()
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
async def search_chats(
    query: str, scope: Literal["workspace", "all"] = "workspace", limit: int = 10
) -> dict[str, Any]:
    """Search past chat transcripts for a phrase (case-insensitive substring, 2-200 chars).

    For recalling what was discussed or decided in earlier chats that nobody saved to
    memory — try search_memory first. scope "workspace" searches this chat's workspace,
    "all" searches every workspace. Newest first; returns up to `limit` chats (1-200),
    each with up to 5 matching message snippets. Read a hit in full with get_messages.
    truncated means more matches exist; narrow the query.
    """
    client, _ = _session()
    workspace_id = await _current_workspace_id() if scope == "workspace" else None
    data = await client.search_chats(query, workspace_id, limit)
    results = [
        {
            "chat_id": r["chat_id"],
            "title": r["chat_title"],
            "workspace_id": r["workspace_id"],
            "workspace_name": r["workspace_name"],
            "match_count": r["match_count"],
            "matches": [
                {
                    "message_id": m["message_id"],
                    "role": m["role"],
                    "snippet": m["snippet_before"] + m["snippet_match"] + m["snippet_after"],
                    "created_at": m["created_at"],
                }
                for m in r["matches"]
            ],
        }
        for r in data["results"]
    ]
    return {"results": results, "truncated": data["truncated"]}


@mcp.tool()
async def list_personas() -> dict[str, Any]:
    """List custom personas available for send_message's `persona` argument.

    Returns each persona's name and system prompt content. Pass a name as `persona` to
    send_message; if none are defined or `persona` is omitted, the standard "Default"
    persona is used.
    """
    client, _ = _session()
    personas = await client.list_personas()
    return {
        "personas": [{"name": p["name"], "content": p["content"]} for p in personas]
    }


@mcp.tool()
async def get_persona(name: str) -> dict[str, Any]:
    """Get a persona's name and system prompt content.

    `name` must match an existing persona (see list_personas). Returns name and content
    so you can inspect or copy a persona before updating it or using it with send_message.
    """
    client, _ = _session()
    persona = await client.get_persona(name)
    return {"persona": {"name": persona["name"], "content": persona["content"]}}


@mcp.tool()
async def create_persona(name: str, content: str) -> dict[str, Any]:
    """Create a custom persona usable as send_message's `persona` argument.

    `name` is the unique label you'll pass as `persona` (it must not match an existing
    persona); `content` is the system prompt that shapes the agent's behavior for turns
    using this persona. Returns the created persona's name.
    """
    client, _ = _session()
    persona = await client.create_persona(name, content)
    return {"persona": {"name": persona["name"]}}


@mcp.tool()
async def update_persona(name: str, content: str) -> dict[str, Any]:
    """Replace an existing persona's system prompt.

    `name` must match an existing persona (see list_personas); `content` fully replaces
    its current system prompt. Chats already streaming keep the prompt they started with;
    new turns pick up the updated one. Returns the updated persona's name.
    """
    client, _ = _session()
    persona = await client.update_persona(name, content)
    return {"persona": {"name": persona["name"]}}


@mcp.tool()
async def delete_persona(name: str) -> dict[str, Any]:
    """Delete a custom persona permanently.

    `name` must match an existing persona (see list_personas). Chats that used it keep
    their history, but new turns can no longer select it. Returns {"deleted": true}.
    """
    client, _ = _session()
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
    base_branch: str | None = None,
    fast_mode: bool = False,
    persona: str | None = None,
    when_busy: Literal["queue", "steer"] | None = None,
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
    base_branch: start the worktree from this branch instead of current HEAD; only used with worktree=true.

    Follow-up turns (chat_id given) inherit the chat's previous model_id, thinking_mode
    and persona when you omit them — pass a value only to change it for this turn.

    when_busy decides what happens if the chat already has a turn running (by default
    the call fails): "queue" adds the prompt to the chat's queue, which runs it as the
    next turn once the current one finishes; "steer" injects it into the running turn
    when the agent supports it and the per-turn options match that turn, otherwise it
    interrupts the running turn and starts this prompt next. A queued or steered prompt
    returns status "queued" or "steering" with queued_message_id instead of message_id.

    When the target is a sub-thread, AgentRove notifies this (parent) chat when the
    sub-thread's turn finishes (completed, failed or interrupted). If you are still
    mid-turn, the notice is injected into your running turn when your agent supports
    it; otherwise a new turn starts in this chat afterwards. So you don't need to
    poll, and can end your turn.

    Returns immediately with chat_id and the streaming message_id. To read the reply
    yourself, poll get_messages and watch that message's stream_status flip from
    "in_progress" to "completed". The turn runs unattended — it uses the model's full-execution permission
    mode (e.g. bypassPermissions for Claude, full-access for Codex).
    """
    client, _ = _session()
    if chat_id is not None:
        # Inherit last turn's model/persona/effort when omitted (not globals).
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
    try:
        sent = await client.send_message(
            chat_id,
            prompt,
            resolved_model,
            permission_mode=permission_mode,
            thinking_mode=thinking_mode,
            worktree=worktree,
            base_branch=base_branch,
            fast_mode=fast_mode,
            persona=persona,
            report_to_parent=bool(chat.get("parent_chat_id")),
        )
    except ChatBusyError:
        if when_busy is None:
            raise
        queued = await client.queue_message(
            chat_id,
            prompt,
            resolved_model,
            permission_mode=permission_mode,
            send_now=when_busy == "steer",
            thinking_mode=thinking_mode,
            worktree=worktree,
            base_branch=base_branch,
            fast_mode=fast_mode,
            persona=persona,
            report_to_parent=bool(chat.get("parent_chat_id")),
        )
        steering = when_busy == "steer" and not queued["send_now_failed"]
        return {
            "chat_id": chat_id,
            "queued_message_id": queued["id"],
            "status": "steering" if steering else "queued",
        }
    return {
        "chat_id": chat_id,
        "message_id": sent["message_id"],
        "status": "in_progress",
    }


@mcp.tool()
async def render_ui(title: str, html: str) -> dict[str, Any]:
    """Render an interactive UI widget (calculator, form, chart, simulation, ...) in the chat.

    `html` is a self-contained HTML fragment with inline <style> and <script> only. It
    runs in an isolated sandbox: no network, CDNs, fetch, cookies, localStorage, or
    parent-document access; images and fonts must be data: or blob: URLs. The host
    styles plain button/input/select elements and provides the CSS variables
    --color-text-primary, --color-background-secondary, --color-border-tertiary,
    --font-sans and --border-radius-md. Keep calculations, filters and other local
    interactions inside the widget. On an explicit user action, call
    window.agentrove.sendMessage(text) to put text in the user's composer — it is not
    sent until the user presses Send, so never call it on load. Form submit handlers
    must call preventDefault(); form actions are blocked. Do not implement the MCP Apps
    handshake yourself; the host supplies it. The widget is rendered from this call's
    arguments once the call completes (it does not stream), so the result carries
    nothing to act on. Returns {"rendered": true, "title": title}.
    """
    return {"rendered": True, "title": title}


@mcp.tool()
async def stop_chat(chat_id: str) -> dict[str, Any]:
    """Stop the in-progress agent turn in a chat, e.g. a sub-thread started with send_message.

    Cancels the running turn and waits briefly for it to unwind, so a follow-up
    send_message to the same chat can start right away. The partial reply is kept with
    stream_status "interrupted" (see get_messages). Stopping an idle chat is a no-op. The
    chat this server runs inside (get_current_chat) can't be stopped — that would cancel
    the turn making this call. Returns {"stopped": true}.
    """
    client, current_chat_id = _session()
    if chat_id == current_chat_id:
        raise AgentroveError("Cannot stop the current chat from within its own turn.")
    await client.stop_chat(chat_id)
    return {"stopped": True}


@mcp.tool()
async def get_messages(
    chat_id: str,
    limit: int = 20,
    cursor: str | None = None,
) -> dict[str, Any]:
    """Read messages from an AgentRove chat; cursor pagination reaches the full history.

    Each call returns up to `limit` messages (1-100) with role, content_text and
    stream_status, ordered oldest-to-newest within the page. The first call (no cursor)
    returns the MOST RECENT messages; pass the returned next_cursor to fetch the
    preceding, older page. Repeat while has_more is true to read the entire chat —
    no part of the history is unreachable.

    Also returns context_usage — {tokens_used, context_window, percentage} for the
    chat's agent session (null until the first turn completes). A high percentage
    means follow-ups in this chat run with little headroom; prefer a fresh chat or
    sub-thread with a distilled handoff instead of continuing a nearly-full one.
    """
    client, _ = _session()
    page = await client.get_messages(chat_id, limit=limit, cursor=cursor)
    context_usage = await client.get_context_usage(chat_id)
    # Backend is newest-first; reverse for chronological readability.
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
        "context_usage": context_usage,
    }


@mcp.tool()
async def list_channels(workspace_id: str | None = None) -> dict[str, Any]:
    """List multi-agent channels, optionally filtered by workspace_id.

    Returns channel settings and members, including each member's chat_id. Use a
    channel's id with post_channel_message to continue its discussion and with
    get_channel_messages to read replies. Omit workspace_id to list channels across
    all workspaces.
    """
    client, _ = _session()
    channels = await client.list_channels(workspace_id)
    return {"channels": [_channel_summary(channel) for channel in channels]}


@mcp.tool()
async def create_channel(
    name: str,
    members: Annotated[list[ChannelMember], Field(min_length=1)],
    workspace_id: str | None = None,
    worktree: bool = False,
    branch: str | None = None,
) -> dict[str, Any]:
    """Create a multi-agent channel for a discussion or debate.

    Supply at least one member, each with a model_id from list_models and optional
    display_name, persona (a name from list_personas), and thinking_mode (as in
    send_message). Display names must match [A-Za-z0-9][A-Za-z0-9._-]{0,31}.
    Members run unattended with their model's full-execution permission mode.
    Omit workspace_id to use the most recently active workspace. Set worktree=true
    for an isolated git worktree. branch selects the checkout or worktree base branch.

    Returns the channel summary, including its id and each member's chat_id. Creating
    the channel does not start the discussion: call post_channel_message with its id.
    Members reply asynchronously; read the discussion with get_channel_messages.
    """
    client, _ = _session()
    resolved_workspace = await client.resolve_workspace_id(workspace_id)
    resolved_members = []
    for member in members:
        resolved_model, agent_kind = await client.resolve_model(member.model_id)
        resolved_members.append(
            {
                **member.model_dump(exclude_none=True),
                "model_id": resolved_model,
                "permission_mode": PERMISSION_MODE_BY_AGENT[agent_kind],
            }
        )
    body: dict[str, Any] = {
        "name": name,
        "members": resolved_members,
        "workspace_id": resolved_workspace,
        "worktree": worktree,
        "branch": branch,
    }
    channel = await client.create_channel(body)
    return {"channel": _channel_summary(channel)}


@mcp.tool()
async def post_channel_message(channel_id: str, content: str) -> dict[str, Any]:
    """Post a message as the user to a channel, triggering its members' replies.

    Members reply asynchronously; use get_channel_messages with the channel_id to
    read the discussion and members' replies.
    Returns the posted message_id, channel_id, seq and status, not the members' replies.
    """
    client, _ = _session()
    message = await client.post_channel_message(channel_id, content)
    return {
        "message_id": message["id"],
        "channel_id": message["channel_id"],
        "seq": message["seq"],
        "status": message["status"],
    }


@mcp.tool()
async def get_channel_messages(channel_id: str, after_seq: int = 0) -> dict[str, Any]:
    """Read a channel's conversation oldest-first, ordered by seq.

    Pass the highest seq seen as after_seq to get only newer messages. Each message
    includes its author's display name (or "user"), member_id, content and status.
    Status is "streaming" while a member is replying and content is partial, then
    "completed" when done; "cancelled" and "deleted" also occur.

    Use this to follow a debate in one call instead of reading each member's chat.
    """
    client, _ = _session()
    channel = await client.get_channel(channel_id)
    messages = await client.get_channel_messages(channel_id, after_seq)
    authors = {
        member["id"]: member["display_name"]
        for member in channel["members"] + channel.get("former_members", [])
    }
    return {
        "messages": [
            {
                "id": message["id"],
                "seq": message["seq"],
                "author": (
                    "user"
                    if message["member_id"] is None
                    else authors[message["member_id"]]
                ),
                "member_id": message["member_id"],
                "content": message["content"],
                "status": message["status"],
                "created_at": message["created_at"],
            }
            for message in messages
        ]
    }


@mcp.tool()
async def stop_channel(channel_id: str) -> dict[str, Any]:
    """Stop a channel's members' in-progress replies and drop queued, undelivered messages.

    Partial replies stay with status "cancelled" in get_channel_messages. Members won't
    answer the queued messages. The channel stays open; post_channel_message resumes
    the discussion. Stopping an idle channel is a no-op. A chat cannot stop a channel
    it belongs to from within its own turn, since that would cancel the calling turn.
    Returns {"stopped": true}.
    """
    client, chat_id = _session()
    channel = await client.get_channel(channel_id)
    if any(
        member["chat_id"] == chat_id
        for member in channel["members"]
    ):
        raise AgentroveError(
            "Cannot stop a channel this chat is a member of from within its own turn."
        )
    await client.stop_channel(channel_id)
    return {"stopped": True}


@mcp.tool()
async def list_automations() -> dict[str, Any]:
    """List your scheduled automations.

    Each automation runs its prompt on a cron schedule, starting a new unattended chat
    every time it fires. Returns id, name, cron_expression, timezone, enabled, model_id,
    workspace_id and the next_run_at / last_run_at timestamps. Use an id with
    update_automation, delete_automation or run_automation.
    """
    client, _ = _session()
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
    channel_id: str | None = None,
) -> dict[str, Any]:
    """Create a scheduled automation that runs a prompt on a cron schedule.

    Each time the schedule fires, AgentRove starts a new unattended chat and sends the
    prompt using the model's full-execution permission mode (e.g. bypassPermissions for
    Claude, full-access for Codex). cron_expression is a standard 5-field cron string
    evaluated in `timezone` (an IANA name like "America/New_York"). Omit model_id to use
    a Claude model and workspace_id to use the most recently active workspace. Per-run
    options (thinking_mode, worktree, persona) match send_message. Set
    enabled=false to create it paused.

    Pass channel_id (a channel in the same workspace, from list_channels) to post the
    prompt into that channel instead of starting a chat: each run adds it, prefixed with
    "[Automation: <name>]", as a user message to the channel's queue, delivered as soon
    as the channel is idle; a run is skipped while the previous one is still queued.
    Model, thinking_mode, worktree and persona are not used for a channel target.

    Returns the created automation, including its id and next_run_at.
    """
    client, _ = _session()
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
    if channel_id:
        body["channel_id"] = channel_id
    automation = await client.create_automation(body)
    if channel_id:
        _require_channel_target(automation)
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
    channel_id: str | None = None,
) -> dict[str, Any]:
    """Update an existing automation; only the arguments you pass are changed.

    Pass model_id to switch models (its permission mode is updated to match), enabled to
    pause/resume, or cron_expression/timezone to reschedule (next_run_at is recomputed).
    Pass channel_id to post each run into that channel (see create_automation), or an
    empty string to go back to starting a new chat per run.
    Returns the updated automation.
    """
    client, _ = _session()
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
    if channel_id is not None:
        body["channel_id"] = channel_id or None
    automation = await client.update_automation(automation_id, body)
    if channel_id:
        _require_channel_target(automation)
    return {"automation": _automation_summary(automation)}


@mcp.tool()
async def delete_automation(automation_id: str) -> dict[str, Any]:
    """Delete a scheduled automation permanently. Returns {"deleted": true}."""
    client, _ = _session()
    await client.delete_automation(automation_id)
    return {"deleted": True}


@mcp.tool()
async def run_automation(automation_id: str) -> dict[str, Any]:
    """Trigger an automation immediately, without waiting for its schedule.

    Starts a new unattended chat with the automation's prompt right now; the regular cron
    schedule (next_run_at) is unaffected. Returns the chat_id of the new chat — poll
    get_messages on it to read the reply. For a channel target it returns channel_id
    instead — read the replies with get_channel_messages — and queued=false when the run
    was skipped because the previous run is still waiting in the channel's queue.
    """
    client, _ = _session()
    result = await client.run_automation(automation_id)
    if result.get("channel_id"):
        return {"channel_id": result["channel_id"], "queued": result.get("queued")}
    return {"chat_id": result["chat_id"]}


if __name__ == "__main__":
    mcp.run()
