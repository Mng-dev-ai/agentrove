# Chat

A single-user conversation with an AI agent, plus its messages, sub-threads, queued messages, and per-message git checkpoints. Owns chat lifecycle and the user-facing event log; *does not* own the streaming runtime (see `streaming.md`) or the agent process (see `providers.md`).

## Entry points

- Models: `backend/app/models/db_models/chat.py` — `Chat`, `Message`, `MessageAttachment`, `MessageEvent`, `ChatCheckpoint`.
- Service: `backend/app/services/chat.py` — `ChatService` (CRUD, search, sub-thread aggregation).
- Service: `backend/app/services/message.py` — `MessageService` (persistence, event log).
- Endpoint: `backend/app/api/endpoints/chat.py` — REST + SSE.
- Schemas: `backend/app/models/schemas/chat.py`.
- Frontend context: `frontend/src/contexts/ChatContext.tsx` (static metadata) + `ChatSessionContext.tsx` (dynamic session).
- Frontend hooks: `frontend/src/hooks/useChatData.ts`, `frontend/src/hooks/queries/useChatQueries.ts`.

## Vocabulary

- **Chat** — top-level conversation. Carries `workspace_id`, `parent_chat_id` (for sub-threads), `worktree_cwd` (per-chat git worktree if used), `session_id`, `session_agent_kind` (the ACP agent assigned).
- **Message** — single turn. Has `role` (user/assistant), `stream_status` (`in_progress` / `completed` / `failed` / `interrupted`), `content_text` (rendered text), `content_render` (JSON event log), `checkpoint_id` (FK to ChatCheckpoint).
- **MessageEvent** — individual stream events persisted alongside the message; replayed on reconnection.
- **ChatCheckpoint** — git tree snapshot captured before a message runs. Stores `base_head` (commit SHA) + `pre_run_diff` (unified diff). Enables per-message restore without replaying full history.
- **Sub-thread** — child chat under `parent_chat_id`. Listed under the parent in the sidebar; `sub_thread_count` is loaded via subquery in pagination.
- **Send-now** vs **queued** — queued messages wait in Redis (`chat:{id}:queue`); a "send-now" cancels the in-flight message and re-prompts immediately (PR #454).

## Message state machine

```
queued → processing → streaming → complete
                              └→ cancelled (user stop)
                              └→ failed (error)
                              └→ interrupted (process died)
```

- **queued** — enqueued in Redis (`QueueService`), FIFO per chat. Frontend shows queue cards above input bar.
- **processing** — `StreamEventKind.QUEUE_PROCESSING` event emitted; row dequeued.
- **streaming** — `StreamEventKind.STREAM` events flowing; SNAPSHOT_EVENT_KINDS buffered, control events flushed immediately.
- **complete / cancelled / failed / interrupted** — terminal. `stream_status` set; final snapshot persisted to `Message.content_render`.

State transitions go through `ChatService` and the streaming runtime — never write `stream_status` from a route directly.

## Cross-domain edges

- → **streaming**: chat hands off to `services/streaming/` for stream lifecycle. Read `docs/domains/streaming.md` before touching `StreamEnvelope` or event kinds.
- → **providers (ACP)**: the agent process is selected via `session_agent_kind` and orchestrated by `AgentService` + `services/acp/`. See `docs/domains/providers.md`.
- → **sandbox**: each chat references a sandbox via its workspace; tools execute via `SandboxService`. See `docs/domains/sandbox.md`.
- → **git**: per-message checkpoints captured by `GitService.create_checkpoint()`; restore by checkpoint id. See `docs/domains/git.md`.
- → **frontend cache**: stream completions write directly to TanStack Query cache via `queryClient.setQueryData(...)`. Off-screen completions must route by `envelope.chatId`, not the currently-mounted chat (PR #432).

## Gotchas

- **`last_event_seq` gates reconnection.** SSE consumers must provide `?seq=N` to catch up. Resume replays from `Message.content_render.events`.
- **Cancelled runs still mutate state.** Cache invalidations for server-side state must run regardless of terminal kind. Terminal-kind gating applies only to UI (toasts, notifications).
- **Send-now is cancel + re-prompt**, not a queue prepend. The currently streaming message gets a `cancelled` terminal event before the new one starts (PR #454).
- **Sub-thread parent invalidation** — when a sub-thread completes, the parent's `sub_thread_count` may need cache refresh. Use the prefix key for broad invalidation.
- **Permission mode and thinking mode are chat-scoped**, not user-scoped (PR #396) — they live on the chat, not on `UserSettings`.

## Recent prior art

- **PR #592** — Add per-message git checkpoints with restore. Adds `ChatCheckpoint`, threads checkpoint capture into the agent run, exposes restore endpoint. Read for: full feature flow across model + service + endpoint + frontend.
- **PR #593** — Add changed files panel under assistant messages. Read for: how a new sandbox-aware UI element plugs into a message bubble.
- **PR #594** — Expand per-file diffs inline in changed files panel. Follow-up to #593.
- **PR #560** — Add chat search across all workspaces. Read for: a clean cross-workspace query/endpoint pair.
- **PR #419** — Add sub-threads: parent-child chat hierarchy. Read for: how the parent_chat_id relationship was introduced.
- **PR #251** — Support queuing multiple messages per chat. Read for: queue semantics.
- **PR #454** — Immediately process send-now messages via cancel + re-prompt.
