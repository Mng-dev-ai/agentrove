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

### Design Philosophy

- Fully monochrome — no brand/blue accent colors in structural UI
- Clean, minimal, refined — subtle over visually heavy
- When multiple visual approaches are viable (connector styles, layout, color), present visual mockups for selection before implementation

### Color Palette

- Refer to `frontend/tailwind.config.js` for defined colors
- Never hardcode hex or default Tailwind colors (`bg-gray-100`, `text-blue-600`, ...)
- Every light color class must have a `dark:` counterpart, and every `dark:` class a light-mode one — never one without the other
- Surface tokens: `surface-primary`, `surface-secondary` (most used), `surface-tertiary`, `surface-hover`, `surface-active` — dark variants `surface-dark-*`
- Border tokens: `border-border` (default), `border-border-secondary`, `border-border-hover` — dark `border-border-dark-*`; prefer `border-border/50` + `dark:border-border-dark/50` for subtle borders
- Text tokens: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-quaternary` — dark `text-text-dark-*`
- **Never use `brand-*` for buttons, switches, highlights, focus rings, or structural elements** — UI is fully monochrome
- Primary buttons: `bg-text-primary text-surface` / `dark:bg-text-dark-primary dark:text-surface-dark` (inverted text/surface)
- Switches/toggles: `bg-text-primary` checked, `bg-surface-tertiary` unchecked
- Focus rings: `ring-text-quaternary/30` — never `ring-brand-*`
- Search highlights: `bg-surface-active` / `dark:bg-surface-dark-hover`
- Selected/active states: `bg-surface-active` / `dark:bg-surface-dark-active`
- Semantic colors (`success`, `error`, `warning`, `info`) are for status indicators only, not layout or interactive button backgrounds
- Use opacity sparingly for glassmorphism (`/50`, `/30`); white/black only as opacity overlays (`bg-white/5`, `bg-black/50`), never solid
- Don't use opacity below `/30` for structural lines (connectors, tree branches, dividers) — use `/50` minimum

### Typography

- `text-xs` default, `text-sm` for primary inputs, `text-2xs` for meta/section headers, `text-lg` for dialog titles only — avoid `text-base`+ in dense UI
- `font-medium` for standard emphasis; `font-semibold` only for page titles (`text-xl`) and section headers; avoid `font-bold` except special display (auth codes)
- Form labels: `text-xs text-text-secondary` — no icons next to labels
- Panel section headers: `text-2xs font-medium uppercase tracking-wider text-text-quaternary`
- `font-mono` for code, URIs, package names, env vars, file paths, technical IDs — pair with `text-xs` or `text-2xs`

### Borders & Radius

- Standard border: `border border-border/50 dark:border-border-dark/50`; full opacity only for prominent dividers
- Radius: `rounded-md` small (buttons, inputs), `rounded-lg` standard containers/cards, `rounded-xl` prominent cards/dropdowns, `rounded-2xl` overlays; button sizes follow `sm: rounded-md`, `md: rounded-lg`, `lg: rounded-xl`
- Shadows: `shadow-sm` interactive, `shadow-medium` dropdowns/panels, `shadow-strong` modals; use `backdrop-blur-xl` + `bg-*/95` for frosted dropdowns
- No custom shadow tokens (`shadow-soft`, `shadow-harsh`) — only `shadow-sm` / `shadow-medium` / `shadow-strong`

### Icons

- Default `h-3.5 w-3.5` for toolbars/action buttons/small controls
- `h-4 w-4` for message actions and form controls
- `h-3 w-3` for text-adjacent icons, badges, close buttons
- `h-5 w-5` or `h-6 w-6` for empty states/status indicators — never `h-16 w-16`+
- Color: `text-text-tertiary` / `dark:text-text-dark-tertiary` default, `text-text-primary` on hover/active
- Toolbar dropdown selectors (model, thinking, permission): text-only labels with chevrons, no left icons
- Loading spinners: `text-text-quaternary` / `dark:text-text-dark-quaternary` — never brand colors
- Don't generate SVG path data from memory — fetch official brand icon SVGs from authoritative sources (Simple Icons, brand asset pages)

### Panel Headers

- `h-9` height with `px-3` padding
- File paths / technical labels: `font-mono text-2xs`
- Section labels: `text-2xs font-medium uppercase tracking-wider text-text-quaternary`
- Icon buttons: `h-3 w-3`, no background, hover `text-text-primary`

### Animations & Transitions

- Use CSS keyframe animations via Tailwind (`animate-fade-in`, `animate-fade-in-up`, `animate-dot-pulse`) — no `framer-motion` or other JS animation libs
- `transition-colors duration-200` for hover/focus; `transition-all duration-300` for complex state changes (drag-and-drop)
- `transition-[padding] duration-500 ease-in-out` for sidebar/layout animations
- Loading: `animate-spin` for circular spinners only (`Loader2`); `animate-pulse` for non-circular loading icons and skeletons; `animate-bounce` with staggered `animationDelay` for dot loaders
- Expandable content: `transition-all duration-200` with `max-h-*` + `opacity` toggling
- Dropdowns: `animate-fadeIn` — no scale transforms on buttons
- Delay-reveal loading indicators for data that usually resolves fast (`opacity-0` + `animationDelay` ~300ms + explicit `animationFillMode: 'forwards'`) so fast loads render nothing — an immediate spinner trades one flash for another (see `ListManagementTab`)

### Layout

- Don't use absolute positioning for sibling layout — use flexbox (`flex`, `justify-between`, `gap-*`); reserve `absolute` for overlays, tooltips, dropdowns, decorative elements
- When action buttons have variable-length or long labels, stack vertically (`flex-col`) at full width
- When nesting child items under parents (e.g., sub-threads), always maintain visible indentation — connector lines supplement but indentation is the primary hierarchy signal
