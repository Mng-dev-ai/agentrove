# CLAUDE.md

## SQLAlchemy Model Conventions

- Always add `server_default=` when using `default=` - the `default` only applies in Python/ORM, while `server_default` ensures the database has the default value for raw SQL inserts
- Always specify `nullable=True` or `nullable=False` explicitly
- Always add max length to String fields (e.g., `String(64)` not just `String`)
- Use `DateTime(timezone=True)` for all datetime fields for consistency
- Don't add `index=True` on FK columns if a composite index starting with that column already exists (composite indexes can serve single-column lookups)

## Migration Workflow

- Do not create migration files manually; generate them via Alembic autogenerate first
- Manual edits to generated Alembic migrations are allowed when necessary for correctness
- Run Alembic migration commands inside the Docker backend container (not on host)

## Code Style

- Don't add comments or docstrings for self-explanatory code
- Let the code speak for itself - use clear variable/function names instead of comments
- Avoid no-op pass-through wrappers (e.g., a function that only calls another function with identical args/return)
- If a wrapper exists, it must add concrete value (validation, transformation, error handling, compatibility boundary, or stable public API surface)
- Prefer direct imports/calls over indirection when behavior is unchanged
- Do not call private methods (`_method`) from outside the file where they are defined; if cross-file usage is needed, make the method public and rename it accordingly
- Do not use inline imports; only allow inline imports when required to avoid circular imports and no cleaner module-level import structure exists
- Strong typing only: do not use `# type: ignore`, `# pyright: ignore`, `# noqa` to silence typing/import issues; fix the types/usages directly (if absolutely unavoidable, document why in the PR description)
- Do not add backward compatibility paths, fallback paths, or legacy shims unless explicitly requested

## Frontend UI/UX Guidelines

### Design Philosophy
- Fully monochrome aesthetic — no brand/blue accent colors in structural UI
- Clean, minimal, and refined — prefer subtlety over visual weight
- Every element should feel quiet and intentional

### Color Palette
- Always refer to `frontend/tailwind.config.js` for defined colors
- Never hardcode hex codes or use default Tailwind colors (`bg-gray-100`, `text-blue-600`, etc.)
- Every light color class must have a `dark:` counterpart
- Surface tokens: `surface-primary`, `surface-secondary` (most used), `surface-tertiary`, `surface-hover`, `surface-active` — dark variants are `surface-dark-*`
- Border tokens: `border-border` (default), `border-border-secondary`, `border-border-hover` — dark variants are `border-border-dark-*` — prefer `border-border/50` and `dark:border-border-dark/50` for subtle borders
- Text tokens: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-quaternary` — dark variants are `text-text-dark-*`
- **Never use `brand-*` colors for buttons, switches, highlights, focus rings, or structural elements** — the UI is fully monochrome
- Primary buttons: `bg-text-primary text-surface` / `dark:bg-text-dark-primary dark:text-surface-dark` (inverted text/surface)
- Switches/toggles: `bg-text-primary` when checked, `bg-surface-tertiary` when unchecked
- Focus rings: `ring-text-quaternary/30` — never `ring-brand-*`
- Search highlights: `bg-surface-active` / `dark:bg-surface-dark-hover` — never `bg-brand-*`
- Selected/active states: `bg-surface-active` / `dark:bg-surface-dark-active` — never `bg-brand-*`
- Semantic colors (`success`, `error`, `warning`, `info`) are only for status indicators, not layout
- Use opacity modifiers sparingly for glassmorphism (`/50`, `/30` are common) — white/black only as opacity overlays (`bg-white/5`, `bg-black/50`), never solid

### Typography
- `text-xs` is the default for most UI, `text-sm` for primary inputs, `text-2xs` for meta-data and section headers, `text-lg` for dialog titles only — avoid `text-base` and larger in dense UI
- `font-medium` is the standard for emphasis — use `font-semibold` only for page titles (`text-xl`) and section headers — avoid `font-bold` except for special display elements like auth codes
- Form labels: `text-xs text-text-secondary` — no icons next to labels
- Section headers in panels: `text-2xs font-medium uppercase tracking-wider text-text-quaternary`
- Use `font-mono` for code snippets, URIs, package names, env vars, file paths, and technical identifiers — pair with `text-xs` or `text-2xs`

### Borders & Radius
- Standard border pattern: `border border-border/50 dark:border-border-dark/50` for most containers — use full opacity `border-border dark:border-border-dark` only for prominent dividers
- Radius hierarchy: `rounded-md` for small elements (buttons, inputs), `rounded-lg` for standard containers and cards (most common), `rounded-xl` for prominent cards and dropdowns, `rounded-2xl` for overlays — button sizes follow `sm: rounded-md`, `md: rounded-lg`, `lg: rounded-xl`
- Shadow hierarchy: `shadow-sm` for interactive elements, `shadow-medium` for dropdowns and panels, `shadow-strong` for modals — use `backdrop-blur-xl` with `bg-*/95` for frosted glass dropdowns

### Icons
- Default icon size is `h-3.5 w-3.5` for toolbars, action buttons, and small controls
- Use `h-4 w-4` for message actions and form controls
- Use `h-3 w-3` for text-adjacent icons, badges, and close buttons
- Use `h-5 w-5` or `h-6 w-6` for empty states and status indicators — never `h-16 w-16` or larger
- Icon color is `text-text-tertiary` / `dark:text-text-dark-tertiary` by default, `text-text-primary` on hover/active
- Toolbar dropdown selectors (model, thinking, permission): text-only labels with chevrons, no left icons
- Loading spinners: `text-text-quaternary` / `dark:text-text-dark-quaternary` — never brand colors

### Panel Headers
- Standardized `h-9` height with `px-3` padding
- File paths and technical labels: `font-mono text-2xs`
- Section labels: `text-2xs font-medium uppercase tracking-wider text-text-quaternary`
- Icon buttons in headers: `h-3 w-3` icons, no background, hover with `text-text-primary`

### Auth Pages
- Page titles: `text-xl font-semibold` — not `text-3xl font-bold`
- Subtitles: `text-sm text-text-tertiary`
- Card: `rounded-xl border border-border/50 bg-surface-tertiary p-6 shadow-medium` with dark variants
- Form spacing: `space-y-3.5` between fields, `space-y-1.5` between label and input
- Submit buttons: `variant="primary" size="lg"` — no gradient overlays, no scale transforms, no Zap icons
- Error alerts: `rounded-lg border border-error-500/20 bg-error-500/10 p-3` with `text-xs`
- Info/success boxes: `bg-surface-hover/50 border-border/50` — never blue backgrounds
- Status icons: `h-5 w-5` or `h-6 w-6` — never `h-16 w-16`
- Helper text below cards: `text-2xs text-text-quaternary`

### Animations & Transitions
- Use `framer-motion` for state transitions (`AnimatePresence mode="wait"`, `motion.div` with `initial`/`animate`/`exit`) — common values: `opacity: 0→1`, `y: 5→0`, `scale: 0.98→1`
- Use `transition-colors duration-200` for hover/focus, `transition-all duration-300` for complex state changes like drag-and-drop
- Use `transition-[padding] duration-500 ease-in-out` for sidebar/layout animations
- Loading states: `animate-spin` for spinners, `animate-pulse` for skeletons, `animate-bounce` with staggered `animationDelay` for dot loaders
- Expandable content: `transition-all duration-200` with `max-h-*` and `opacity` toggling
- Dropdowns: `animate-fadeIn` for entry — no scale transforms on buttons

## Completion Quality Gate

- Do not leave dead code behind. If a change makes code unused, remove it in the same task (unused functions, exports, imports, constants, types, files, and stale wrappers).
- Every task must include a final dead-code sweep across touched areas and any newly created files.
- Before finishing, verify all newly created or modified code paths:
  - Confirm new symbols are referenced (or intentionally public and documented).
  - Confirm replaced symbols were removed and references updated.
  - Run relevant checks (at minimum targeted type/lint/test commands for the changed area).
- If something is intentionally left unused for compatibility, state that explicitly in the final summary.
