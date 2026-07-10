# Frontend Refactor Conventions (Tailwind → SCSS Modules)

This is the authoritative guide for the ongoing frontend refactor. Every migration task
follows these rules exactly. The foundation (design tokens, mixins, migrated
`components/ui/primitives/`) is already in place — study it before writing anything.

## Goal

Replace Tailwind utility classes with **co-located SCSS Modules** driven by a global
design-token layer, and restructure components folder-per-component — modeled on the a24
frontend architecture. Behavior, DOM structure, accessibility attributes, and visual
appearance must not change unless the task explicitly says so. This is a styling/structure
refactor, not a redesign.

## Reference implementations (read these first)

- `src/components/ui/primitives/Button/` — variants + sizes via BEM modifiers, control mixins
- `src/components/ui/primitives/Dropdown/` — complex component: panel, z-layer, state classes, responsive compaction, `:global(.is-open)` state styling
- `src/components/ui/primitives/Switch/` — `data-state` attribute styling, nested element modifiers
- `src/styles/globals/` — the entire token layer

## Token layer (`src/styles/globals/`)

| File                  | Provides                                                                                                                             | Use                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `_colors.scss`        | `--theme-*` semantic vars, `theme-color($token, $opacity)`, `status-color($name, $step, $opacity)`                                   | ALL colors                                |
| `_spacing.scss`       | `--space-N` vars, `space($n)` fn                                                                                                     | ALL margin/padding/gap/inset/size steps   |
| `_typography.scss`    | `type-meta/default/body/large/title/page-title/section-header/mono` mixins + `type-overflow`, `type-lineclamp($n)`, `type-noselect`  | ALL font sizing                           |
| `_responsive.scss`    | `media($query)`, `hover`, `active`, `hide`, `show` mixins                                                                            | ALL breakpoints + hover/active            |
| `_elevation.scss`     | `--radius-*`, `--shadow-sm/medium/strong/inset`                                                                                      | ALL radius/shadows                        |
| `_animations.scss`    | `--duration-*`, `--easing-*`, global keyframes (`fade-in`, `fade-in-up`, `spin`, `pulse`, `shimmer`, ...), `transition-colors` mixin | ALL motion                                |
| `_zlayer.scss`        | `z($layer)` mixin (`raised/sticky/sidebar/titlebar/dropdown/modal/command-menu/tooltip/toast`)                                       | ALL z-index (never bare)                  |
| `_state-classes.scss` | `$state-*` class names (mirrored in `src/config/stateClasses.ts`)                                                                    | JS-driven state styling                   |
| `_controls.scss`      | `focus-ring`, `button-base/size/variant`, `input-base/error` mixins                                                                  | building new controls (prefer primitives) |

Import what you need per module with the standard namespaces:

```scss
@use '@/styles/globals/colors' as colors;
@use '@/styles/globals/typography' as type;
@use '@/styles/globals/responsive' as responsive;
@use '@/styles/globals/animations' as anim;
@use '@/styles/globals/state-classes' as state;
@use '@/styles/globals/zlayer' as z;
@use '@/styles/globals/controls' as controls;
```

## Component structure

- **Folder-per-component**: `Sidebar/Sidebar.tsx` + `Sidebar.module.scss` co-located.
  Multi-component features keep domain-prefixed siblings flat in the feature folder, each
  with its own module.
- **No barrel/index.ts files** — import directly: `@/components/layout/Sidebar/Sidebar`.
- **No `forwardRef`** — React 19 `ref` as a plain prop.
- Root element of a component carries a class named 1:1 with the component (kebab-case):
  `.sidebar` for `Sidebar`.
- Class names are **kebab-case**; access hyphenated names with brackets
  (`styles['chat-row']`), single words with dots (`styles.sidebar`).
- Variants are BEM-ish modifier classes composed with `clsx`:
  `clsx(styles.button, styles[`button--${size}`], styles[`button--${variant}`], className)`.
- JS-driven states use `stateClasses` from `@/config/stateClasses` on the TSX side and
  `&:global(.#{state.$state-open}) { ... }` on the SCSS side — never hardcode `is-*`
  strings. Where the DOM already has a semantic hook (`aria-selected`, `data-state`,
  `:disabled`), style that attribute instead of adding a state class.
- A module must never style another component's internals — style only your own DOM.
  Pass `className` down when a parent needs to position a child.
- Keep every component's public prop API unchanged unless the task says otherwise.

## TypeScript component style

- Components are **function declarations**, props destructured in the signature:
  `export function Name({ a, b }: NameProps) { ... }` (unexported when file-local).
- **Never `React.FC` / `FC`** — type props via the signature (enforced by ESLint
  `no-restricted-syntax` / `no-restricted-imports`).
- Props are `interface NameProps` named 1:1 with the component; export the interface
  only when another module needs it.
- `memo` inline form only: `export const Name = memo(function Name(props: NameProps) { ... });`
  — never the two-step `NameInner` + `memo(NameInner)`.
- **Named exports only** (sole exception: `App.tsx`, imported as default by `main.tsx`).
  Lazy-loading a named export goes through `lazyNamed()` from `@/utils/lazyNamed` — never
  a `.then((m) => ({ default: m.X }))` remap or a default export added for `lazy()`.
- Files stay under ~400 lines — split along natural seams into co-located siblings
  (components) or focused modules/hooks (logic) before crossing the ceiling.

## SCSS rules

- **Colors**: only `var(--theme-*)` / `theme-color()` / `status-color()` / `--theme-<status>-text`.
  Never hex, never `rgb()` literals. UI is fully monochrome — status colors are for
  status indication only.
- **Spacing**: only `var(--space-N)` / `space()`. `px` allowed only for never-rescaling
  art (1px borders, switch-knob geometry).
- **Typography**: only `type-*` mixins; never raw `font-size`.
- **Radius/shadows**: only `var(--radius-*)` / `var(--shadow-*)`.
- **Breakpoints**: only `media()` / `hide()` / `show()`. Never raw `@media`.
- **Hover**: only the `hover` mixin (guards `(hover: hover)`), never bare `&:hover`.
- **z-index**: only `@include z.z('layer')`.
- **Transitions**: only `--duration-*` / `--easing-*` vars; `transition-colors` mixin for
  the standard hover transition.
- Mixin includes go at the top of a rule block, before declarations.
- Dark mode: semantic vars make most styling theme-free. For the rare light/dark
  divergence a semantic token can't express, use `:global([data-theme='dark']) & { ... }`
  (see `SegmentedControl.module.scss`).

## Tailwind → SCSS mapping (mechanical reference)

| Tailwind                                                             | SCSS                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bg-surface-secondary dark:bg-surface-dark-secondary`                | `background-color: var(--theme-surface-secondary);`                                                                |
| `text-text-tertiary dark:text-text-dark-tertiary`                    | `color: var(--theme-text-tertiary);`                                                                               |
| `border-border/50 dark:border-border-dark/50`                        | `border-color: colors.theme-color('border', 0.5);`                                                                 |
| `bg-text-primary text-surface dark:...` (inverted)                   | `background: var(--theme-text-primary); color: var(--theme-surface);` (or `surface-inverse`/`text-inverse` tokens) |
| `text-error-600 dark:text-error-400`                                 | `color: var(--theme-error-text);`                                                                                  |
| `bg-error-500`                                                       | `background-color: colors.status-color('error', 500);`                                                             |
| `p-3`, `gap-1.5`, `mt-2`                                             | `padding: var(--space-3); gap: var(--space-1-5); margin-top: var(--space-2);`                                      |
| `h-3.5 w-3.5` (icons)                                                | `height: var(--space-3-5); width: var(--space-3-5);`                                                               |
| `text-xs` / `text-2xs` / `text-sm` / `text-lg`                       | `@include type.type-default;` / `type-meta` / `type-body` / `type-title`                                           |
| `text-2xs font-medium uppercase tracking-wider text-text-quaternary` | `@include type.type-section-header;`                                                                               |
| `font-mono text-2xs`                                                 | `@include type.type-mono-meta;`                                                                                    |
| `truncate`                                                           | `@include type.type-overflow;`                                                                                     |
| `rounded-md/lg/xl/2xl/full`                                          | `border-radius: var(--radius-md/lg/xl/2xl/full);`                                                                  |
| `shadow-sm/medium/strong`                                            | `box-shadow: var(--shadow-sm/medium/strong);`                                                                      |
| `transition-colors duration-200`                                     | `@include anim.transition-colors;`                                                                                 |
| `animate-spin` / `animate-pulse` / `animate-fade-in`                 | `animation: spin 1s linear infinite;` / `pulse 2s var(--easing-in-out) infinite` / `@include anim.fade-in;`        |
| `hover:bg-surface-hover dark:hover:...`                              | `@include responsive.hover { background-color: var(--theme-surface-hover); }`                                      |
| `focus-visible:ring-2 ring-text-quaternary/30`                       | `@include controls.focus-ring;`                                                                                    |
| `hidden sm:block`                                                    | `@include responsive.show('sm-up');`                                                                               |
| `sm:hidden`                                                          | `@include responsive.hide('sm-up');`                                                                               |
| `z-50`, `z-[60]`                                                     | `@include z.z('dropdown');` (pick the semantic layer)                                                              |
| `sr-only`                                                            | global `.sr-only` class (keep the literal class name)                                                              |
| `flex items-center justify-between gap-2`                            | plain flexbox declarations                                                                                         |
| `backdrop-blur-xl bg-*/95` (frosted panels)                          | `backdrop-filter: blur(24px); background-color: colors.theme-color('surface-secondary', 0.95);`                    |

Layout utilities (`flex`, `grid`, `absolute`, `inset-0`, `min-w-0`, `flex-1`, `shrink-0`,
`overflow-*`) translate to their obvious CSS declarations — no tokens involved.

## Migration procedure per file

1. Read the component; list every Tailwind class it uses.
2. Create/extend the co-located `.module.scss` translating with the table above.
   Collapse `x dark:y` pairs into the single semantic token.
3. Replace `className` strings with `styles[...]` composition via `clsx`. Remove
   `cn()`/`tailwind-merge` usage in migrated files (plain `clsx`).
4. Move the file into its component folder if it isn't already (`git mv`), updating ALL
   imports repo-wide (no barrels).
5. Split god components (>400 lines) into co-located subcomponents while you're there —
   same folder, domain-prefixed names — but do not change behavior.
6. Verify: `npx tsc --noEmit -p tsconfig.app.json` and `npx vite build` from `frontend/` (the plain `npm run typecheck` is a no-op — the root tsconfig checks nothing). Pre-existing errors in OTHER areas may appear; your area must be clean.

## Hard boundaries

- The migration is COMPLETE — Tailwind is removed. These conventions now govern all new
  frontend work.
- If a token/mixin you need is genuinely missing, approximate with the closest existing
  token and leave a `// TODO(refactor):` comment — do not invent new global tokens.
- Don't rename exported symbols or change component APIs.
- Commit your work with a descriptive message when done.
