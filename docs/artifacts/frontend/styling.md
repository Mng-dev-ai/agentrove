# Frontend Styling — Tailwind, Tokens, UI Primitives

Read this **before writing any `className` or modifying any styled component.**

Styling is **Tailwind only** — no CSS modules, no styled-components, no inline `style={{...}}` for layout. The codebase is **fully monochrome** (no brand/blue accents in structural UI), with semantic tokens in `frontend/tailwind.config.js`. Every light class has a `dark:` counterpart.

---

## Design philosophy

- Fully **monochrome** — `brand-*` is reserved for opt-in brand surfaces, never for structural UI (buttons, switches, focus rings).
- Clean, minimal, refined — subtle over visually heavy.
- When multiple visual approaches are viable (connector styles, layout, color), present visual mockups for selection before implementing.

---

## Tokens (frontend/tailwind.config.js)

**Never hardcode hex or default Tailwind colors** (`bg-gray-100`, `text-blue-600`, ...). Only use the semantic tokens below.

### Surface

- `surface-primary`, `surface-secondary` (most used), `surface-tertiary`
- `surface-hover`, `surface-active`
- Dark variants: `surface-dark-*`

### Border

- `border-border` (default), `border-border-secondary`, `border-border-hover`
- Dark: `border-border-dark-*`
- Subtle borders: `border-border/50` + `dark:border-border-dark/50`

### Text

- `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-quaternary`
- Dark: `text-text-dark-*`

### Buttons & interactive

- **Primary**: `bg-text-primary text-surface` / `dark:bg-text-dark-primary dark:text-surface-dark` (inverted)
- **Switches/toggles**: `bg-text-primary` checked, `bg-surface-tertiary` unchecked
- **Focus rings**: `ring-text-quaternary/30` — never `ring-brand-*`
- **Search highlights**: `bg-surface-active` / `dark:bg-surface-dark-hover`
- **Selected/active states**: `bg-surface-active` / `dark:bg-surface-dark-active`

### Semantic colors

`success`, `error`, `warning`, `info` — for **status indicators only**, not layout or interactive button backgrounds.

### Opacity

- Use sparingly for glassmorphism (`/50`, `/30`).
- White/black only as opacity overlays (`bg-white/5`, `bg-black/50`), never solid.
- **Don't use opacity below `/30`** for structural lines (connectors, tree branches, dividers) — use `/50` minimum.

---

## Typography

- Default `text-xs`, `text-sm` for primary inputs, `text-2xs` for meta/section headers, `text-lg` for dialog titles. Avoid `text-base`+ in dense UI.
- `font-medium` for standard emphasis. `font-semibold` only for page titles (`text-xl`) and section headers. Avoid `font-bold` except special display (auth codes).
- Form labels: `text-xs text-text-secondary` — no icons next to labels.
- Panel section headers: `text-2xs font-medium uppercase tracking-wider text-text-quaternary`.
- `font-mono` for code, URIs, package names, env vars, file paths, technical IDs — pair with `text-xs` or `text-2xs`.

---

## Borders & radius

- Standard border: `border border-border/50 dark:border-border-dark/50`. Full opacity only for prominent dividers.
- Radius: `rounded-md` (small — buttons, inputs), `rounded-lg` (standard containers/cards), `rounded-xl` (prominent cards/dropdowns), `rounded-2xl` (overlays). Button sizes: `sm: rounded-md`, `md: rounded-lg`, `lg: rounded-xl`.
- Shadows: `shadow-sm` (interactive), `shadow-medium` (dropdowns/panels), `shadow-strong` (modals). Frosted dropdowns: `backdrop-blur-xl` + `bg-*/95`.
- **No custom shadow tokens** (`shadow-soft`, `shadow-harsh`) — only the three above.

---

## Icons (lucide-react)

- Default `h-3.5 w-3.5` for toolbars / action buttons / small controls.
- `h-4 w-4` for message actions and form controls.
- `h-3 w-3` for text-adjacent icons, badges, close buttons.
- `h-5 w-5` or `h-6 w-6` for empty states / status indicators — **never** `h-16 w-16`+.
- Color: `text-text-tertiary` / `dark:text-text-dark-tertiary` default; `text-text-primary` on hover/active.
- Toolbar dropdown selectors (model, thinking, permission): text-only labels with chevrons; no left icons.
- Loading spinners: `text-text-quaternary` / `dark:text-text-dark-quaternary` — never brand colors.
- **Don't generate SVG path data from memory** — fetch official brand icon SVGs from authoritative sources (Simple Icons, brand asset pages).

---

## UI primitives — reuse, don't reinvent

`components/ui/primitives/` exists so feature components don't duplicate styling/focus/disabled handling.

- `Button`, `Input`, `Select`, `Spinner`, `Switch`, `Textarea`, ... (etc).
- For fully custom looks: `variant="unstyled"` — keeps focus-visible and disabled styles, removes everything else. Don't duplicate those built-in styles in `className`.
- **No raw HTML interactive elements** (`<button>`, `<input>`, `<select>`, `<a>`) when a primitive exists. (See `components.md`.)

---

## Panel headers

- `h-9` height with `px-3` padding.
- File paths / technical labels: `font-mono text-2xs`.
- Section labels: `text-2xs font-medium uppercase tracking-wider text-text-quaternary`.
- Icon buttons: `h-3 w-3`, no background, hover `text-text-primary`.

---

## Animations & transitions

- **Tailwind keyframe animations only** — `animate-fade-in`, `animate-fade-in-up`, `animate-dot-pulse`. **No `framer-motion`** or other JS animation libs.
- `transition-colors duration-200` for hover/focus.
- `transition-all duration-300` for complex state changes (drag-and-drop).
- `transition-[padding] duration-500 ease-in-out` for sidebar/layout animations.
- Loading: `animate-spin` for circular spinners only (`Loader2`); `animate-pulse` for non-circular loading icons and skeletons; `animate-bounce` with staggered `animationDelay` for dot loaders.
- Expandable content: `transition-all duration-200` with `max-h-*` + `opacity` toggling.
- Dropdowns: `animate-fadeIn` — no scale transforms on buttons.

---

## Layout

- **Don't use absolute positioning for sibling layout** — use flexbox (`flex`, `justify-between`, `gap-*`). Reserve `absolute` for overlays, tooltips, dropdowns, decorative elements.
- When action buttons have variable-length or long labels, **stack vertically** (`flex-col`) at full width.
- When nesting child items under parents (e.g., sub-threads), **always maintain visible indentation** — connector lines supplement but indentation is the primary hierarchy signal.

---

## Responsive awareness

Before removing a UI element, **check whether it serves a responsive/functional role beyond its visual purpose**. Icons often double as compact-mode fallbacks (`compactOnMobile`); labels may be the only visible element at some breakpoints.

---

## Bundle size & dynamic imports (cross-cutting with data-fetching)

Heavy libraries **must** use dynamic `import()`, never static:

- `xlsx`, `jszip`, `xterm`, `@monaco-editor/react`, `react-vnc`, `qrcode`, `dompurify`, `mermaid`.

Heavy React components: `React.lazy()` + `<Suspense>` (e.g., Monaco in dialogs, VncScreen).

Heavy libraries used in hooks/effects: `await import('lib')` inside the async function. Parallelize with `Promise.all([import('a'), import('b')])` when importing multiple in the same function.

---

## Anti-patterns to refuse

- ❌ **Hardcoded hex colors** (`#fff`, `#3b82f6`).
- ❌ **Default Tailwind palette** (`bg-gray-100`, `text-blue-600`).
- ❌ **Light class without `dark:` counterpart.**
- ❌ **`brand-*` on buttons, switches, focus rings, structural elements.** Monochrome.
- ❌ **Semantic colors (`success`, `error`, etc.) on layout/buttons.** Status indicators only.
- ❌ **Custom shadow tokens** beyond `shadow-sm` / `shadow-medium` / `shadow-strong`.
- ❌ **Raw HTML interactive elements** when a primitive exists.
- ❌ **`framer-motion` or other JS animation libraries.** Tailwind keyframes only.
- ❌ **`forwardRef`** — pass `ref` as a regular prop. (See `components.md`.)
- ❌ **Absolute positioning for sibling layout.** Use flexbox.
- ❌ **Static imports of heavy libraries.** Dynamic.
- ❌ **Opacity below `/30` for structural lines.**

---

## When you're stuck — canonical examples

- Tailwind config tokens: `frontend/tailwind.config.js`
- Primitive with `variant="unstyled"`: `frontend/src/components/ui/primitives/Button.tsx`
- Panel header convention: search for `text-2xs font-medium uppercase tracking-wider` in `components/`.
- Dynamic-import + `React.lazy` page wrap: `frontend/src/App.tsx`.

---

## Recent prior art

- **PR #481** — Fix message input layout and design token corrections. Read for: token discipline at scale.
- **PR #488** — Migrate raw buttons to Button primitive. Read for: replacing raw HTML with primitives.
- **PR #483** — Redesign sidebar layout and chat item styling. Read for: sidebar transition pattern.
- **PR #484** — Custom title bar with traffic lights and sidebar profile. Read for: layout composition with desktop awareness.
- **PR #381** — Improve frontend performance, accessibility, and component architecture.
