# CLAUDE.md (frontend)

## Component Architecture

### React Version

- React 19 — use `use()` instead of `useContext()`; pass `ref` as a regular prop instead of `forwardRef`

### UI Primitives

- Never use raw HTML interactive elements (`<button>`, `<input>`, `<select>`, `<a>`) when a primitive exists in `components/ui/primitives/` — use `Button`, `Input`, etc.; for fully custom styling use `variant="unstyled"` (keeps focus-visible and disabled styles); don't duplicate those built-in styles in `className`

### Composition Patterns

- Avoid boolean prop proliferation (`isX`, `showX`, `hideX`) — use composition instead
- When a component exceeds ~10 props or has 3+ boolean flags, refactor to a context provider + compound components
- Use the `state / actions` context interface pattern: `{ state: StateType; actions: ActionsType }`
- Context definitions go in `*Definition.ts`, providers in `*Context.tsx` / `*Provider.tsx`, consumer hooks in `hooks/use*.ts`
- Consumer hooks use React 19 `use()` and throw if context is null (see `useChatSessionContext.ts`)
- Provider values must be `useMemo`'d to prevent unnecessary re-renders

### Provider Pattern for Complex Components

- When a component has extensive internal hook logic (file handling, suggestions, mutations), lift it into a `*Provider.tsx` that wraps children with context
- Outer component keeps its prop-based API; internally wrap `<Provider {...props}><Layout /></Provider>`
- Sub-components read from context via `use*Context()` hooks
- References: `InputProvider.tsx`, `ChatSessionProvider`, `FileTreeProvider`

### No Fallback Patterns in Context Interfaces

- Context interface fields must not be optional (`?`) when the provider always supplies them
- Don't add nullability guards (`value && doSomething()`) on context values guaranteed by the provider
- Don't add `?? null` / `?? false` / `?? []` coercions unless the upstream genuinely returns `undefined`

### State Ownership

- Don't write computed defaults into persisted stores (Zustand `persist`/localStorage) while their inputs (queries, message history) are still resolving — a persisted guess permanently wins over the later-derived value
- Shared presentational components must not write to stores or commit defaults — defaulting/validation belongs to the single state-owner hook or provider; components take `value`/`onChange` only

### Existing Context Hierarchy

- `ChatProvider` (`contexts/ChatContext.tsx`) — static chat metadata: `chatId`, `sandboxId`, `fileStructure`, `customAgents`, `customSlashCommands`, `customPrompts`
- `ChatSessionProvider` (`contexts/ChatSessionContext.tsx`) — dynamic chat session state: messages, streaming, loading, permissions, input message, model selection
- `InputProvider` (`components/chat/message-input/InputProvider.tsx`) — input internals: file handling, drag-and-drop, suggestions, enhancement, submit logic
- `LayoutContext` (`components/layout/layoutState.tsx`) — sidebar state
- `FileTreeProvider` (`components/editor/file-tree/FileTreeProvider.tsx`) — file tree selection/expansion state

### Responsive Awareness

- Before removing a UI element, check whether it serves a responsive/functional role beyond its visual purpose — icons often double as compact-mode fallbacks (`compactOnMobile`); labels may be the only visible element at some breakpoints

### File Placement

- When extracting non-component code (contexts, utils, hooks) from a component file, place it in the canonical folder (`contexts/`, `utils/`, `hooks/`)
- `components/chat/tools/` is exclusively for tool components (one per tool type) — helper modals/dialogs/detail views belong in `components/chat/` or a relevant feature folder
- Shared UI used by 2+ feature areas belongs in `components/ui/shared/`

### Event Handler Signatures

- Never pass a callback directly to `onClick` (or similar) when it expects domain-typed args — wrap in an arrow: `onClick={() => handler(value)}`, not `onClick={handler}` (React passes the event as the first arg)

### useEffect Discipline

- Never place hooks (`useState`, `useCallback`, `useMemo`, `useEffect`) after conditional early returns
- Never call `useEffect` directly for mount-only effects — use `useMountEffect()` from `hooks/useMountEffect.ts`
- Never use `useEffect` to derive state from other state/props — use inline computation or `useMemo`; `useEffect(() => setX(f(y)), [y])` causes an extra render cycle
- When state must reset on a prop/ID change, use a ref-based render check: `const prevRef = useRef(prop); if (prevRef.current !== prop) { prevRef.current = prop; setState(initial); }`
- Distinguish "derived state" from "form state init" — if local state is a copy of server data the user then edits independently (secrets/settings forms), syncing via `useEffect` on query data change is correct
- `useEffect` cleanup closures must not rely on hook-scoped utilities that close over the current entity ID when cleanup may serve sessions from a different entity — use refs or the underlying API (e.g., `queryClient.setQueryData` with `session.chatId`)
- When state is keyed by an input so render derives a `pending` flag as `stored.input !== currentInput`, the effect must update state for every input value — bailing on falsy inputs (`if (!x) return`) leaves `stored.input` stale and the pending flag locked on forever
- Ref-based render checks may only set the same component's state — when the value is parent-owned (written via a callback prop), use `useEffect`; updating a parent during a child's render is illegal
- When local state overrides an ambient value that resolves asynchronously, derive the effective value (`local || ambient`) instead of seeding state from the prop at mount and patching it later

### Component Variants

- Create explicit variant components instead of one with many boolean modes (e.g., `ThreadComposer`, `EditComposer` instead of `<Composer isThread isEditing />`)
- Use `children` for composing static structure; render props only when the parent needs data back from the child

### Action Gating

- When a React Query uses `placeholderData` / `keepPreviousData`, gate destructive actions derived from that data on `!isPlaceholderData`
- Gate action buttons on backend capability, not UI rendering state — hide only the affordances that genuinely require rendered rows

## Types

- When a Pydantic response model field has a default, the corresponding frontend TypeScript type must mark it required
- Don't introduce a new frontend type when an existing one has the same shape — reuse directly across modules
- When spreading a caller-provided options object into a builder, use `Omit<>` to exclude keys the factory controls — prevents silent shadowing at the type level

## Cross-cutting gotchas

- When extracting a shared utility from multiple callers with slightly different semantics, verify equivalence for every edge-case input (`null`, `undefined`, `0`, `""`)
- Don't extract a shared React hook when callers must add `useCallback`/`useMemo` wrappers that the inline version didn't need
- In JSX conditionals with numeric values, use explicit checks (`value != null && value > 0`) — `0` renders as text in React
- Route cross-context event handlers (SSE, WebSocket, pub/sub, stream callbacks) by the event's own identifiers (`envelope.chatId`), not hook-scoped ones — the latter silently misdirects off-screen updates
- When a terminal/completion handler needs metadata about the completed entity, capture it at session/handle creation — don't resolve from the currently-viewed entity at completion time; off-screen completions land when the user has navigated elsewhere
- For off-screen entities that need fresh state on next mount, patch the cache optimistically during the stream/mutation (`queryClient.setQueryData`) — `invalidateQueries` alone isn't enough since `useQuery` serves cached data on mount during the background refetch
- Terminal-kind gating (cancelled vs complete) applies only to UI-side concerns (notifications, toasts). Cache invalidations for server-side state mutated during the turn must run regardless — cancelled runs still leave real side effects
- When a change makes a previously-always-present value possibly empty, add the guard to every submission path (send, queue, retry/reconnect) — parallel paths don't share validation
- Before removing or gating a shared component's implicit behavior (auto-select, auto-commit defaults), audit every caller for reliance on it and move that behavior into the callers that need it
- When giving a sentinel prop value (`null`/`undefined`) new semantics in a shared component, check every caller's TypeScript type for that value — call sites that read like plain arrays may be `T[] | null`

## Performance Conventions

### Bundle Size

- No barrel/index.ts files — import directly from the source (e.g., `from '@/components/layout/Layout'`)
- Heavy libraries must use dynamic `import()`, never static: `xlsx`, `jszip`, `xterm`, `@monaco-editor/react`, `react-vnc`, `qrcode`, `dompurify`, `mermaid`
- Heavy React components: `React.lazy()` + `<Suspense>` (e.g., Monaco in dialogs, VncScreen)
- Heavy libraries used in hooks/effects: `await import('lib')` inside the async function
- Audit `package.json` periodically for unused deps

### Async-to-Sync Migration Safety

- When converting sync (useMemo/inline) to async (useEffect + useState with dynamic imports), clear the previous state at the top of the effect before async work
- Pattern: `useEffect(() => { setState(initial); if (!input) return; let cancelled = false; (async () => { ... })(); return () => { cancelled = true; }; }, [input])`

### Re-render Optimization

- Zustand action selectors used only in callbacks: use `useStore.getState().action()` at the call site — don't subscribe via `useStore((s) => s.action)`
- Don't wrap Zustand `set(...)` in `startTransition` inside store definitions — use synchronous `set`; `startTransition` belongs in components/hooks
- Zustand selectors must return stable references — never create new objects/arrays/`Set`/`Map` inside the selector; derive with `useMemo`
- Use `Set` for membership checks in render loops — `useMemo(() => new Set(arr), [arr])` + `.has()` instead of `.includes()`
- Don't wrap trivial expressions in `useMemo` (e.g., `useMemo(() => x || [], [x])`) — use `x ?? []`
- When query keys include optional dimensions (e.g., `cwd`), add a separate prefix key without the optional dimension for broad invalidation (e.g., `gitBranchesAll: (id) => ['sandbox', id, 'git-branches']`) — invalidation with `undefined` doesn't prefix-match real values
- Hoist regex patterns to module-level constants — never create `RegExp` inside loops/frequently-called functions
- Prefer single-pass `.reduce()` over chained `.filter().map()` in render paths
- When reordering a function call earlier in a per-event hot path, gate it with the cheapest condition at the call site
- Keep `useEffect` for external system subscriptions and DOM side effects (keyboard shortcuts, resize observers, WebSocket lifecycle, scroll-into-view, focus management) — don't convert these to ref-based render checks
- When unifying components with variant-specific features, gate Zustand selectors to return a stable value for variants that don't use that state (e.g., `useStore((s) => needsFeature ? s.value : false)`)
- When invalidating a React Query key built from an identifier, verify the format matches consumers' — cwd-relative vs workspace-root-relative paths miss each other; when formats can diverge, invalidate a prefix key (e.g., `fileContentAll`)

### Async Patterns

- Use `Promise.all()` for independent async ops (e.g., multiple `queryClient.invalidateQueries()` calls)
- When dynamically importing multiple libraries in the same function, parallelize: `Promise.all([import('a'), import('b')])`
- When discarding a promise with `void`, attach `.catch()` — `void fn().catch(err => console.error(err))`

## UI/UX Guidelines

Styling is SCSS Modules + a global design-token layer (`src/styles/globals/`) — see
`frontend/REFACTOR.md` for the full conventions and the Tailwind→token mapping table.
Tailwind has been removed.

### Design Philosophy

- Fully monochrome — no brand/blue accent colors in structural UI
- Clean, minimal, refined — subtle over visually heavy
- When multiple visual approaches are viable (connector styles, layout, color), present visual mockups for selection before implementation

### Styling System

- Co-located `.module.scss` per component (folder-per-component); kebab-case classes; variants as BEM-ish `&--modifier` composed with `clsx`
- Colors: only `var(--theme-*)` semantic vars / `theme-color()` / `status-color()` from `_colors.scss` — they flip automatically with `data-theme`, so never write light/dark styles twice; rare divergences use `:global([data-theme='dark']) &`
- Semantic colors (`--color-success/error/warning/info-*`, `--theme-<status>-text`) are for status indication only, never structural/interactive elements
- Spacing: `var(--space-N)` only; typography: `type-*` mixins only (`type-default` 12px is the app default, `type-meta` 10px for meta/section headers, `type-body` 14px for primary inputs, `type-title` 18px for dialog titles only)
- Section headers: `@include type.type-section-header;` (10px uppercase wide-tracked quaternary)
- `type-mono*` mixins for code, URIs, package names, env vars, file paths, technical IDs
- Radius/shadows: `var(--radius-md/lg/xl/2xl)` and `var(--shadow-sm/medium/strong)` only — md for small controls, lg for standard containers, xl for prominent cards/dropdowns, 2xl for overlays
- z-index: only `@include z.z('layer')` from `_zlayer.scss` — never bare values
- Breakpoints/hover: only `media()` / `hover()` / `active()` mixins from `_responsive.scss` — never raw `@media` or bare `&:hover`
- JS-driven states: `stateClasses` from `@/config/stateClasses` + `&:global(.#{state.$state-*})`; prefer styling semantic hooks (`aria-selected`, `data-state`, `:disabled`) when the DOM already has them
- Focus rings: `@include controls.focus-ring;` — monochrome, never brand-colored

### Icons

- Default `height/width: var(--space-3-5)` for toolbars/action buttons/small controls
- `var(--space-4)` for message actions and form controls; `var(--space-3)` for text-adjacent icons, badges, close buttons
- `var(--space-5)`/`var(--space-6)` for empty states/status indicators — never larger
- Color: `var(--theme-text-tertiary)` default, `var(--theme-text-primary)` on hover/active
- Loading spinners: `var(--theme-text-quaternary)` — never brand colors
- Don't generate SVG path data from memory — fetch official brand icon SVGs from authoritative sources (Simple Icons, brand asset pages)

### Panel Headers

- `height: var(--space-9)` with `padding-inline: var(--space-3)`
- File paths / technical labels: `@include type.type-mono-meta;`
- Section labels: `@include type.type-section-header;`

### Animations & Transitions

- Global keyframes live in `_animations.scss` (`fade-in`, `fade-in-up`, `spin`, `pulse`, `shimmer`, ...) — no framer-motion or other JS animation libs
- `@include anim.transition-colors;` for hover/focus; durations/easings only via `--duration-*` / `--easing-*` vars
- Loading: `spin` for circular spinners only; `pulse` for non-circular loading icons and skeletons
- Delay-reveal loading indicators for data that usually resolves fast (opacity 0 + `animationDelay` ~300ms + explicit `animationFillMode: 'forwards'`) so fast loads render nothing (see `ListManagementTab`)

### Layout

- Don't use absolute positioning for sibling layout — use flexbox; reserve `absolute` for overlays, tooltips, dropdowns, decorative elements
- When action buttons have variable-length or long labels, stack vertically at full width
- When nesting child items under parents (e.g. sub-threads), always maintain visible indentation — connector lines supplement but indentation is the primary hierarchy signal
