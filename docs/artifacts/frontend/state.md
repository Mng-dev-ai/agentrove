# Frontend State Management

Read this **before adding a Zustand store, a React context, or new global state.**

State splits into three layers: **server state** (TanStack Query — see `data-fetching.md`), **global UI state** (Zustand stores), and **scoped feature state** (React contexts). Pick deliberately; don't mix them.

---

## When to use what

| Need | Use |
|---|---|
| Data fetched from the API | TanStack Query (`hooks/queries/`) |
| Auth token, theme, sidebar collapsed, model selection (cross-cutting) | Zustand store |
| Per-feature in-memory state (chat session, file tree, settings page) | React context |
| Per-component state (open/close, hover, draft input) | `useState` |

If a piece of state is read by 1 component, use `useState`. If 3+ components in one feature share it, use a context. If half the app sees it, use a Zustand store.

---

## Zustand stores

Located in `frontend/src/store/`. One file per concern:

| Store | Owns |
|---|---|
| `authStore.ts` | `isAuthenticated`, current user, access token |
| `chatStore.ts` | `currentChat`, attached files |
| `modelStore.ts` | selected model |
| `streamStore.ts` | active stream state |
| `messageQueueStore.ts` | queued messages per chat |
| `permissionStore.ts` | pending agent permission requests |
| `chatSettingsStore.ts` | per-chat settings |
| `updateStore.ts` | desktop update banner state |
| `uiStore.ts` | misc UI flags |

### ⚠️ Advisory rules

- **Use synchronous `set(...)` inside store definitions.** Don't wrap in `startTransition` — that belongs in components/hooks. (See PR #230 — Use getState() for Zustand actions.)
- **Action selectors used only in callbacks: use `useStore.getState().action()`** at the call site — don't subscribe via `useStore((s) => s.action)`. Subscribing forces re-renders the callback doesn't need.
- **Selectors must return stable references.** Never create new objects/arrays/`Set`/`Map` inside a selector. Derive with `useMemo` in the consumer if you need a derived structure.
- **Gate selectors when the value is variant-specific** — e.g., `useStore((s) => needsFeature ? s.value : false)` returns a stable `false` for variants that don't use the feature.

### Anti-patterns

- ❌ **`startTransition` inside `set(...)`.**
- ❌ **Selectors that allocate** (`(s) => ({ a: s.a, b: s.b })` — every render is a new object).
- ❌ **Subscribing to actions** when you only call them in event handlers. Use `getState()`.

---

## React contexts

See `components.md` for the full context-pattern (Definition + Context/Provider + consumer hook). Recap of the existing hierarchy:

| Context | Where | Why a context, not a store |
|---|---|---|
| `ChatProvider` | `contexts/ChatContext.tsx` | per-chat scope; recreated on chat switch |
| `ChatSessionProvider` | `contexts/ChatSessionContext.tsx` | per-session; carries streaming + UI state |
| `InputProvider` | `components/chat/message-input/InputProvider.tsx` | feature-scoped (input bar) |
| `LayoutContext` | `components/layout/layoutState.tsx` | sidebar — could be Zustand, currently context |
| `FileTreeProvider` | `components/editor/file-tree/FileTreeProvider.tsx` | per-tree selection/expansion |
| `SettingsProvider` | `contexts/SettingsContext.tsx` | settings-page-scoped |

---

## Anti-patterns to refuse

- ❌ **Putting server data in Zustand or context.** TanStack Query owns it; don't shadow it.
- ❌ **Reading auth token from anywhere except `authStore`.** `lib/api.ts` reads it once; everything else goes through the API client.
- ❌ **Sprinkling `useState` for state that 3+ siblings share.** Lift to a context.
- ❌ **Re-introducing barrel files** to "simplify imports." Don't.

---

## When you're stuck — canonical examples

- Synchronous Zustand action via `getState()`: search `frontend/src/store/` for `useStore.getState`.
- Memoized selector pattern: see consumers of `chatStore` in `components/chat/`.
- Context provider that owns `{ state, actions }` shape: `contexts/ChatSessionContext.tsx`.

---

## Recent prior art

- **PR #230** — Use getState() for Zustand actions and minor perf fixes. Read for: the canonical Zustand-action pattern.
- **PR #381** — Improve frontend performance, accessibility, and component architecture.
- **PR #495** — Fix frontend CLAUDE.md rule violations. Read for: small state-management corrections at scale.
