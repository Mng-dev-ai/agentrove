# Streaming (SSE / WebSocket / `StreamEnvelope`)

The runtime that turns agent process output into ordered events delivered to the frontend. Owns the SSE endpoint for chat streams, the envelope shape, the snapshot persistence, and reconnection semantics. *Does not* own message lifecycle (see `chat.md`) or the agent process (see `providers.md`).

## Entry points

- Runtime: `backend/app/services/streaming/runtime.py` — orchestrates a single stream's lifecycle.
- Types: `backend/app/services/streaming/types.py` — `StreamEnvelope`, `StreamEventKind`, snapshot kinds.
- SSE endpoint: `backend/app/api/endpoints/chat.py` (`stream_chat_sse`).
- WebSocket endpoint (terminal, separate concern): `backend/app/api/endpoints/websocket.py`.
- Frontend: `frontend/src/services/streamService.ts`.

## Vocabulary

- **StreamEnvelope** — the wrapper for every event:
  ```
  {
    chatId: UUID,
    messageId: UUID,
    streamId: UUID,    # unique per stream session
    seq: int,          # monotonic per chat
    kind: StreamEventKind,
    payload: { ... }
  }
  ```
- **StreamEventKind** — discriminator. Examples: `assistant_text`, `assistant_thinking`, `tool_started`, `tool_completed`, `tool_failed`, `user_text`, `permission_request`, `prompt_suggestions`, `usage`, `system`. Plus terminal kinds: `complete`, `cancelled`, `error`.
- **Snapshot events** (`SNAPSHOT_EVENT_KINDS`) — buffered and flushed in batches to `Message.content_render`. Control events (stream_started, complete) persist immediately.
- **Resume cursor** (`?seq=N`) — frontend's last seen `seq`. On reconnect, replay events from `Message.content_render.events` starting after `seq`.
- **Sanitization** — `StreamEnvelope.sanitize_payload()` redacts token/password keys and truncates strings >4KB with a SHA256 hash for audit trail.

## Lifecycle

1. Client submits `ChatRequest` (prompt, model_id, permission_mode, ...) via POST.
2. Backend enqueues (Redis) → immediately returns `ChatCompletionResponse(chat_id, message_id)`.
3. Background `asyncio` task processes queue, emits `QUEUE_PROCESSING` event.
4. Adapter stream starts; `STREAM` events flow (text, tools, thinking, usage).
5. Snapshot events buffer; control events flush.
6. Terminal event (`complete` / `cancelled` / `error`) closes the stream and writes the final snapshot.
7. Client reconnects with `?seq=N` if it disconnected mid-stream.

## Cross-domain edges

- → **chat**: writes to `Message.stream_status` and `Message.content_render` at terminal events. See `chat.md`.
- → **providers (ACP)**: receives raw events from `services/acp/client.py`; translates to `StreamEnvelope` and emits.
- → **frontend cache**: stream events write to TanStack Query via `queryClient.setQueryData(...)`. Off-screen entities must route by `envelope.chatId` (PR #432). For unmounted chats: patch the cache so the next mount sees fresh state.
- → **redis**: stream envelopes are published via `CachePubSub` for cross-process subscribers (PR #370 is the defining example).

## Gotchas

- **Reconnection contract is load-bearing.** Don't change `seq` semantics or replay logic without a plan and a migration story.
- **Sanitize before publishing.** `StreamEnvelope.sanitize_payload()` runs on every outbound payload with arbitrary content. Bypassing it leaks secrets.
- **Prompt suggestions** are extracted via regex from assistant text, sent as a structured `prompt_suggestions` event, then **stripped** from the stored text. If you change the regex, both directions must agree.
- **Cancelled runs still mutate state.** Cache invalidations and side effects run regardless of terminal kind. UI-only concerns (toasts, notifications) are the only thing that gates on terminal kind.
- **Off-screen completion routing.** A callback that closes over the *current* hook scope misroutes when the user navigates. Route by `envelope.chatId`. For terminal-time metadata: capture at session/handle creation, not at completion time. (PR #432.)
- **`anyio` cancel scopes**: stream teardown can hit task-mismatch issues if cancellation isn't propagated cleanly. PR #192 fixed a known case — model that pattern.
- **Partial-delta streaming** is enabled (PR #346) — text and thinking events arrive incrementally. Don't assume whole-block delivery.
- **Don't add distributed coordination.** Stream is in-process. (See `golden_principles.md` §1.)

## Recent prior art

- **PR #370** — Publish full stream envelopes via Redis pub/sub. Defining PR for the envelope-pub/sub pattern.
- **PR #173** — Big Streaming Refactor.
- **PR #190** — Simplify streaming module: consolidate files, flatten entry points.
- **PR #382** — Fix streaming error handling and frontend reconnection.
- **PR #432** — Fix off-screen stream cache writes targeting wrong chat. Read for: routing by `envelope.chatId`.
- **PR #346** — Enable partial delta streaming for text and thinking blocks.
- **PR #214** — Fix immediate resend after stop (stream cancellation handoff).
- **PR #524** — Abort in-flight chat request when Stop pressed during loading.
- **PR #471** — Fix inline stream error rendering.
- **PR #192** — Fix anyio cancel scope task mismatch during stream teardown.
