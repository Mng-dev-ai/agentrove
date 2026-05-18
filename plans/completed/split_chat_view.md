# Split chat view — view two chats side-by-side

**Status:** completed
**Owner:** mngback
**Created:** 2026-05-17
**Last updated:** 2026-05-17
**Related:** (no issue yet — feature request from product)

---

## Context

Today, opening a chat navigates to `/chat/:chatId` and `ChatPage.tsx` mounts a single `ChatSessionOrchestrator` for that one id. Everything downstream — messages query, streaming state, model selector, per-chat settings — assumes one active chat per page.

We already have a working split-pane layer for *view types* (agent / diff / editor / terminal / secrets) built on `react-mosaic-component` and driven by `useUIStore.mosaicLayout` (`frontend/src/store/uiStore.ts:73+`, `frontend/src/components/ui/SplitViewContainer.tsx:16+`). Shift-clicking sidebar items adds tiles to that layout. But the `agent` tile renders against whichever single `chatId` the route has.

Product wants the ability to view two different chats simultaneously — e.g. run two agents in parallel and watch both stream — without juggling browser tabs.

## Goal

A user can open chat A, then add chat B as a second pane next to it via a sidebar action (shift-click a chat, or an explicit "open in split" affordance). Both panes stream independently, each with their own messages, input bar, model selector, and per-chat settings. Closing the second pane returns to the single-chat view. The split state survives a page refresh.

## Non-goals

- **No 3+ chat panes.** Layout supports the tree, but the UI only exposes "add second chat." Revisit later if asked.
- **No cross-chat sync, drag-message-between-panes, or shared context.** The two chats are independent.
- **No shareable split URLs in v1.** Refresh-survival via persisted UI store state is enough; deep-link-with-split can be a follow-up.
- **No mobile split.** Mobile already collapses the mosaic to a single view; the second-chat affordance is hidden under `MOBILE_BREAKPOINT`.
- **No backend changes.** Streaming already routes by `envelope.chatId` (see `docs/domains/streaming.md`); the existing SSE/EventSource pipeline is sufficient.
- **No changes to `frontend/backend-sidecar/`** (hard rule).

## Approach

The core move: **make chat panes first-class mosaic tiles, then scope both `ChatProvider` and `ChatSessionOrchestrator` per agent tile.** The route remains the source of truth for the *primary* chat; the *secondary* chat lives in `uiStore`.

Important current-state constraint: mosaic leaves are currently just `ViewType` strings (`agent`, `editor`, `terminal`, ...). That model cannot represent two `agent` panes because `addTileToMosaic` de-dupes leaves and `react-mosaic-component` requires stable unique tile ids. v1 needs a small tile identity layer before rendering two chats.

### Phase 1 — Foundations (state + provider scoping)

- [x] Extend `frontend/src/types/ui.types.ts` with explicit tile ids:
  - `type MosaicTileId = ViewType | 'agent:primary' | 'agent:secondary'` (or a stricter equivalent).
  - `MosaicLayoutNode` leaves become `MosaicTileId`, not `ViewType`.
  - Add a resolver helper like `getViewTypeForTile(tileId): ViewType` so non-agent views do not need to know about chat slots.
- [x] Update `mosaicHelpers.ts`, `MosaicSplitView.tsx`, `SplitViewContainer.tsx`, and `useActiveViews.ts` to operate on tile ids while deriving `ViewType` for labels/rendering. Preserve existing single-view behavior for `editor`, `terminal`, `diff`, `secrets`, and `prReview`.
- [x] Extend `SplitViewState` in `frontend/src/types/ui.types.ts`: add `secondaryChatId: string | null`. Do **not** add a generalized `tileChatIds` map in v1 unless implementation pressure requires it; the explicit primary/secondary invariant is easier to reason about and test.
- [x] Add actions to `useUIStore` (`frontend/src/store/uiStore.ts`): `openChatInSplit(chatId)`, `closeSplitChat()`, `swapChatPanes()`. `openChatInSplit` creates/keeps a layout containing `agent:primary` and `agent:secondary`; it must not call the existing duplicate-preventing `addTileToMosaic('agent', ...)` path.
- [x] Persist `secondaryChatId` and enough layout state to restore the split. Current `partialize` excludes `mosaicLayout`, so either:
  - persist only `secondaryChatId` and reconstruct `{ first: 'agent:primary', second: 'agent:secondary' }` on chat-page mount, or
  - add a versioned, migrated `mosaicLayout` persist shape that supports tile ids.
- [x] Bump the `uiStore` persist `version` and migrate old `mosaicLayout`/view leaves to the new tile-id shape. Keep deleting unsupported legacy persisted `mosaicLayout` if preserving old split layouts is not worth the migration complexity.
- [x] Clear `secondaryChatId` if the secondary chat no longer exists. Prefer a null-check/query failure in the secondary pane over cross-store subscriptions; delete flow can also call `closeSplitChat()` if the deleted id matches.
- [x] Introduce an `AgentPane`/`ChatPane` component that owns the per-chat data hooks: `useChatData(chatId)`, `useSandboxFiles(currentChat, chatId)`, `useWorkspaceResourcesQuery(currentChat?.workspace_id)`, then wraps its children in `ChatProvider` and `ChatSessionOrchestrator`.
- [x] Audit every `useChatContext()` and `useChatSessionContext()` consumer (grep). Each pane-scoped consumer must read chat/sandbox/session data from the nearest provider. Anything intentionally primary-chat-scoped must keep using route/page state and be named accordingly.
- [x] Replace or explicitly document remaining `useChatStore.currentChat` reads in chat-scoped UI. Known risky reads include branch selector, input controls, and GitHub dialogs; these can cross-talk in split mode unless they move to context or are intentionally primary-only.

### Phase 2 — Render the split

- [x] In the tile renderer, route `agent:primary` to the route `chatId` and `agent:secondary` to `uiStore.secondaryChatId`. Non-agent tiles continue to render against the primary chat/workspace/sandbox.
- [x] Move `ChatProvider` and `ChatSessionOrchestrator` out of the page-wide wrapper and into the `AgentPane` renderer. `ChatPage` remains responsible for route-level layout, sidebar, dialogs, editor/diff/terminal data tied to the primary chat, and global command menu.
- [x] Keep page-level `useChatStore.setCurrentChat(currentChat)` scoped to the primary chat only. Do not rely on it for secondary chat rendering.
- [x] Verify `ChatSettingsStore` (`thinkingModeByChat[chatId]`, etc.) keeps working — it already keys by chatId, so each pane reads its own slice. Spot-check 2–3 settings.
- [x] Verify `attachedFiles` isolation. `ChatSessionOrchestrator` currently reads/writes `useChatStore.attachedFiles`, which is global; split chat likely needs pane-local attachment state or a `attachedFilesByChat` shape to avoid sending pane A's files from pane B.

### Phase 3 — Affordances + polish

- [x] Sidebar chat list: shift-click (desktop only) calls `openChatInSplit(chatId)` instead of `navigate(...)`. Add a tooltip hint. Reuse the shift-click pattern already used for views (see `uiStore.ts:186` comment).
- [x] Add a small "open in split" menu item to the chat row's existing kebab menu, for discoverability.
- [x] Each agent pane gets a header strip showing the chat title + a close (`×`) button. For `agent:secondary`, close calls `closeSplitChat()`. For `agent:primary`, close navigates to the secondary chat and then collapses the split; implement this as one action or carefully order `navigate(...)` + `closeSplitChat()` so stale route state does not flash.
- [x] Hide the split affordance when `window.innerWidth < MOBILE_BREAKPOINT` — same gate `ensureViewVisible` uses.
- [x] Define mobile restore behavior explicitly: below `MOBILE_BREAKPOINT`, render only `agent:primary`; keep `secondaryChatId` persisted so returning to desktop restores the split unless the user explicitly closed it.
- [x] Streaming sanity: confirm two agent panes can stream concurrently. The SSE/EventSource callbacks route by `envelope.chatId` (see `docs/domains/streaming.md`); each `ChatSessionProvider` owns its own chatId-scoped session state.

### Phase 4 — Cleanup

- [x] Update `docs/artifacts/frontend/components.md` and `docs/artifacts/frontend/state.md` to note that `ChatSessionOrchestrator` is now per-tile, not per-page.
- [x] Add a note to `docs/domains/chat.md` describing the split-chat invariant (primary = route, secondary = uiStore).
- [x] Add a Playwright/Vitest smoke covering the open-split → both-stream → close-split flow if the harness supports it; otherwise document manual steps in PR.

## Open questions

- ⏳ Should secondary chat attachments be fully pane-local, or should attachment state become `attachedFilesByChat` in `chatStore`? Current global `attachedFiles` is not safe for two simultaneous input bars.
- ⏳ Do GitHub dialogs / branch selector / command menu actions operate on the focused pane or always on the primary chat? Plan default: dialogs and non-agent views stay primary-only in v1; chat input/model/settings are pane-scoped.
- ⏳ Does *anything* outside `useChatContext()` / `useChatSessionContext()` reach for the route's `chatId` or `useChatStore.currentChat` to do chat-scoped work (analytics, breadcrumbs, document title)? If yes, those need explicit "I want the primary chat" wiring. Will know after Phase 1 audit.
- ⏳ When the secondary chat is the one being actively typed into, should the input focus / command palette target it? Plan default: the *focused* pane is the active one for keyboard shortcuts; visual focus ring on the pane container. Confirm with design.

## Decision log

- **2026-05-17:** updated plan after source review: duplicate `agent` leaves are impossible with the current `ViewType`-as-tile-id mosaic model, so split chat needs unique tile ids (`agent:primary`, `agent:secondary`) before provider scoping can work.
- **2026-05-17:** updated plan after source review: `ChatSessionOrchestrator` already accepts `chatId`; the actual lift is per-pane ownership of `useChatData`, `useSandboxFiles`, `ChatProvider`, and `ChatSessionOrchestrator`.
- **2026-05-17:** decided to **lift `ChatSessionOrchestrator` per agent tile** rather than introduce a global `MultiChatProvider` keyed by chatId. Per-tile lift keeps every existing `useChatSessionContext()` consumer working unchanged (React's nearest-provider lookup does the right thing). A global multi-chat provider would have required every consumer to know its slot id — much wider blast radius.
- **2026-05-17:** decided to keep **route = primary chat** and put **secondary chat in `uiStore`** (persisted) rather than encode both in the URL. Avoids touching `App.tsx:131` route shape and keeps existing bookmarks valid. Shareable split URLs are a follow-up if requested.
- **2026-05-17:** rejected a third pane in v1. The `react-mosaic-component` tree supports it trivially, but the affordance/UX of "which pane gets the new chat?" isn't worth designing before we know users want it.

## Verification

- **Manual:**
  - Open chat A, shift-click chat B in sidebar → both render side-by-side with independent messages.
  - Send a message in A, send a message in B at the same time → both stream concurrently without interleaving.
  - Toggle thinking-mode in A → B is unaffected (confirms per-chat settings still isolated).
  - Refresh the page → split persists with A on left, B on right.
  - Close the secondary pane → returns to single-pane view of A.
  - Close the *primary* pane → route navigates to B, layout collapses to single pane.
  - Delete chat B from the sidebar while it's open in split → secondary pane closes cleanly.
  - Resize the browser below `MOBILE_BREAKPOINT` → secondary pane hides; restore above → it returns.
- **Tests:** unit-test the new `uiStore` actions (`openChatInSplit`, `closeSplitChat`, `swapChatPanes`) including persistence shape. If a Playwright harness exists, add a smoke as above.
- **Regression:** verify existing split views still work: command-menu split editor/diff/terminal/secrets, close tile, drag/reorder mosaic, mobile single-view fallback.
- **Gates:** `npm run lint && npm run typecheck` in `frontend/`. No backend changes → no `pytest` impact.

## Done when

- [x] User can open a second chat in split via shift-click and the kebab menu.
- [x] Both panes have independent messages, streaming, model selector, and settings.
- [x] Split state survives refresh; deleting a chat clears it from the split.
- [x] Primary-pane close swaps secondary in and updates the route.
- [x] Mobile is unaffected — no split affordance below `MOBILE_BREAKPOINT`.
- [x] `docs/artifacts/frontend/components.md`, `docs/artifacts/frontend/state.md`, `docs/domains/chat.md` updated.
- [x] `npm run lint && npm run typecheck` clean.
- [x] Plan moved to `plans/completed/`.
