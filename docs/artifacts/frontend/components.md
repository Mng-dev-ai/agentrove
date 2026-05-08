# Frontend Components

Read this **before adding or modifying any React component, context, or hook.**

The frontend is **React 19 + TypeScript + Vite + TanStack Query + Zustand + Tailwind**, with a Tauri desktop sidecar build. React 19 means: use `use()` instead of `useContext()`, and pass `ref` as a regular prop instead of `forwardRef`.

---

## Where things live

```
frontend/src/
├── components/
│   ├── ui/
│   │   ├── primitives/         # Button, Input, Select, Spinner, Switch, ...
│   │   ├── shared/             # cross-feature UI (CommandMenu, SplitViewContainer, ViewLoadingFallback)
│   │   └── (feature folders)
│   ├── chat/                   # message-bubble, message-input, model-selector, sub-threads, tools
│   ├── editor/                 # editor-core, code-view, file-tree, file-search
│   ├── sandbox/                # terminal, git, secrets
│   ├── settings/               # dialogs, inputs, sections, tabs
│   ├── auth/                   # login/signup forms
│   ├── layout/                 # Layout, sidebar
│   └── routes/                 # route guards (AuthRoute)
├── contexts/                   # *Definition.ts + *Context.tsx + *Provider.tsx
├── hooks/                      # custom hooks
│   └── queries/                # TanStack Query hooks (one file per domain)
├── store/                      # Zustand stores
├── services/                   # API/business-logic clients
│   └── base/                   # BaseService, ServiceError
├── pages/                      # route pages (lazy-loaded in App.tsx)
├── lib/                        # api.ts (APIClient), queryClient.ts
├── utils/                      # pure helpers (cn, format, validation, storage)
├── types/                      # *.types.ts — shared TypeScript types
└── config/                     # constants, toaster
```

**No barrel `index.ts` files.** Always import from source: `import { Layout } from '@/components/layout/Layout'`. (See `golden_principles.md` and `frontend/CLAUDE.md` notes preserved across the harness.)

**`frontend/backend-sidecar/` is a build artifact** — never edit.

---

## Component shape

### ✅ Mechanized

- ESLint + Prettier (CI + lint-staged on commit when hooks installed).
- TypeScript `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` (CI: `tsc --noEmit`).

### ⚠️ Advisory

- **Function components only.** No class components.
- **Pass `ref` as a regular prop** — don't use `forwardRef`. (React 19.)
- **Use `use(Context)` from React 19** — don't use `useContext()`. The codebase wraps this in `createContextHook()` (`hooks/createContextHook.ts`) which throws if context is null.
- **`React.memo()`** is fair when a component re-renders unnecessarily under prop-stable parents — don't sprinkle it preemptively.
- **No raw HTML interactive elements** (`<button>`, `<input>`, `<select>`, `<a>`) when a primitive in `components/ui/primitives/` exists. Use `Button`, `Input`, `Select`, etc. For fully custom styling, use `variant="unstyled"` (preserves focus-visible and disabled states).

---

## Composition patterns

### Avoid boolean prop proliferation

When a component grows past ~10 props or has 3+ booleans (`isLoading`, `isError`, `showHeader`, `hideFooter`), refactor to **compound components** + a context provider.

### Provider pattern (for complex internal logic)

When a component has extensive internal hook logic (file handling, suggestions, mutations), lift it into a `*Provider.tsx` that wraps children with context:

- Outer component keeps its prop-based API.
- Internally: `<Provider {...props}><Layout /></Provider>`.
- Sub-components read from context via `use*Context()`.

References: `InputProvider.tsx` (in `components/chat/message-input/`), `ChatSessionProvider`, `FileTreeProvider`.

### Context interface shape

- Context definitions go in `*Definition.ts`.
- Providers in `*Context.tsx` / `*Provider.tsx`.
- Consumer hooks in `hooks/use*.ts`.
- Use the `{ state, actions }` interface pattern: `interface Foo { state: FooState; actions: FooActions }`.
- Provider value must be `useMemo`'d.
- **Context interface fields are required when the provider always supplies them.** No `?:` and no `?? null` / `?? false` / `?? []` coercion in consumers when the upstream is guaranteed.

### Existing context hierarchy

| Context | Owns |
|---|---|
| `ChatProvider` (`contexts/ChatContext.tsx`) | static chat metadata: `chatId`, `sandboxId`, `fileStructure`, `customSkills`, `builtinSlashCommands`, `personas` |
| `ChatSessionProvider` (`contexts/ChatSessionContext.tsx`) | dynamic session: messages, streaming, loading, permissions, input message, model selection |
| `InputProvider` (`components/chat/message-input/InputProvider.tsx`) | input internals: file handling, drag-drop, suggestions, enhancement, submit |
| `LayoutContext` (`components/layout/layoutState.tsx`) | sidebar state |
| `FileTreeProvider` (`components/editor/file-tree/FileTreeProvider.tsx`) | file tree selection/expansion |
| `SettingsProvider` (`contexts/SettingsContext.tsx`) | settings-page state |

---

## Hooks discipline

- ⚠️ **Never call hooks after a conditional early return.** ESLint catches some cases — review every hook.
- ⚠️ **Mount-only effects: use `useMountEffect()`** (`hooks/useMountEffect.ts`), not raw `useEffect(() => fn(), [])`.
- ⚠️ **Don't use `useEffect` to derive state from other state/props.** Inline computation or `useMemo` instead — `useEffect(() => setX(f(y)), [y])` causes an extra render cycle.
- ⚠️ **State must reset on a prop/ID change** — use a ref-based render check:
  ```tsx
  const prevRef = useRef(prop);
  if (prevRef.current !== prop) { prevRef.current = prop; setState(initial); }
  ```
  Don't use `useEffect` for this.
- ⚠️ **`useEffect` is correct for**: external system subscriptions, DOM side effects (keyboard shortcuts, resize observers, WebSocket lifecycle, scroll-into-view, focus management).
- ⚠️ **Form-state init from server data is OK with `useEffect`** — that's not "derived state," it's a copy the user then edits independently.

### Cross-context handler routing

When a callback handles an event from a different context (SSE, WebSocket, pub/sub), **route by the event's own identifier** (`envelope.chatId`), not the hook-scoped one. Off-screen completions land when the user has navigated elsewhere — see PR #432 (Fix off-screen stream cache writes targeting wrong chat).

For off-screen entities that need fresh state on next mount: patch the cache optimistically during the stream/mutation (`queryClient.setQueryData`). `invalidateQueries` alone isn't enough — `useQuery` serves cached data on mount during background refetch.

---

## Event handlers

- ⚠️ **Never pass a callback directly to `onClick`** when it expects domain-typed args. React passes the event as the first arg.
  - ❌ `onClick={handler}` (where `handler(value)` expects a value)
  - ✅ `onClick={() => handler(value)}`

---

## Variants vs. boolean modes

- Create explicit variant components (e.g., `ThreadComposer`, `EditComposer`) instead of `<Composer isThread isEditing />`.
- Use `children` for static composition. Render props only when the parent needs data back from the child.

---

## Action gating

- React Queries with `placeholderData` / `keepPreviousData`: **gate destructive actions on `!isPlaceholderData`** so the user doesn't act on stale data.
- Gate action buttons on **backend capability**, not UI rendering state — hide affordances that genuinely require rendered rows.

---

## File placement

- Extracted non-component code (contexts, utils, hooks) goes in the canonical folder: `contexts/`, `utils/`, `hooks/` — not next to the component.
- `components/chat/tools/` is **exclusively** for tool components (one per ACP tool kind). Helper modals/dialogs/detail views go elsewhere in `components/chat/` or a feature folder.
- Shared UI used by 2+ feature areas → `components/ui/shared/`.

---

## Async-to-sync migration safety

When converting sync (`useMemo` / inline) → async (`useEffect` + `useState` with dynamic imports), **clear the previous state at the top of the effect** before async work:

```tsx
useEffect(() => {
  setState(initial);
  if (!input) return;
  let cancelled = false;
  (async () => {
    const { fn } = await import('lib');
    if (!cancelled) setState(fn(input));
  })();
  return () => { cancelled = true; };
}, [input]);
```

Otherwise the previous output flashes during the async load.

---

## Anti-patterns to refuse

- ❌ **Raw `<button>` / `<input>` / `<select>` / `<a>`** when a primitive exists.
- ❌ **`forwardRef`** — pass `ref` as a regular prop.
- ❌ **`useContext`** — use `use()` from React 19.
- ❌ **Hooks after a conditional return.**
- ❌ **`useEffect(() => ..., [])` for mount-only.** Use `useMountEffect`.
- ❌ **`useEffect` for derived state.** Inline or `useMemo`.
- ❌ **Barrel files / `index.ts`.** Import from source.
- ❌ **Boolean prop proliferation** beyond ~3 flags. Refactor to compound components.
- ❌ **`?? null` / `?? false` / `?? []` on context values** the provider already supplies.
- ❌ **Numeric values rendered without explicit checks** in JSX. `0` renders as text — write `value != null && value > 0 && ...`.

---

## When you're stuck — canonical examples

- Function component with primitive composition: `frontend/src/components/chat/model-selector/ModelSelector.tsx`
- Provider pattern with `{ state, actions }`: `frontend/src/components/chat/message-input/InputProvider.tsx`
- Context + consumer hook: `frontend/src/contexts/ChatContext.tsx` + `frontend/src/hooks/useChatContext.ts`
- Compound components: `frontend/src/components/editor/code-view/CodeView.tsx`
- Lazy-loaded route page: `frontend/src/pages/ChatPage.tsx` (see `App.tsx` for the lazy wrapper)

---

## Recent prior art

- **PR #381** — Improve frontend performance, accessibility, and component architecture. Read for: refactor scope and component decomposition.
- **PR #488** — Migrate raw buttons to Button primitive & redesign input controls. Read for: how to migrate raw HTML to primitives.
- **PR #475** — Remove expandable prop from ToolCard and auto-derive from children. Read for: killing a boolean prop in favor of composition.
- **PR #495** — Fix frontend CLAUDE.md rule violations. Read for: a sweep of small architecture corrections.
- **PR #573** — Fix Cmd+Shift+O selection reverting and tree not scrolling to file. Read for: ref-based render checks and DOM side effects.
- **PR #422** — Deduplicate frontend code with shared abstractions.
