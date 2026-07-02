import type { PaletteDef } from './palettes';
import { PALETTES } from './palettes';

// Color fields of PaletteDef mapped to their CSS custom-property name (light-base form).
// Dark-base palettes insert `-dark` after the first segment: surface → surface-dark,
// surface-secondary → surface-dark-secondary, text-primary → text-dark-primary.
type ColorField = Exclude<keyof PaletteDef, 'base'>;

const VAR_NAMES: Record<ColorField, string> = {
  surface: 'surface',
  surfaceSecondary: 'surface-secondary',
  surfaceTertiary: 'surface-tertiary',
  surfaceHover: 'surface-hover',
  surfaceActive: 'surface-active',
  border: 'border',
  borderSecondary: 'border-secondary',
  borderHover: 'border-hover',
  textPrimary: 'text-primary',
  textSecondary: 'text-secondary',
  textTertiary: 'text-tertiary',
  textQuaternary: 'text-quaternary',
};

const COLOR_FIELDS = Object.keys(VAR_NAMES) as ColorField[];

// Tailwind reads tokens as `rgb(var(--x) / alpha)`, so vars hold space-separated channels.
const hexToChannels = (hex: string): string => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Invalid palette hex: ${hex}`);
  const n = parseInt(match[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

const toDarkVar = (name: string): string => {
  const i = name.indexOf('-');
  return i === -1 ? `${name}-dark` : `${name.slice(0, i)}-dark${name.slice(i)}`;
};

// Emit the `:root[data-palette=...]` override blocks from the hex source of truth —
// the single producer of the RGB-channel CSS the components consume.
export function generatePaletteCss(): string {
  const blocks = (Object.keys(PALETTES) as (keyof typeof PALETTES)[]).map((name) => {
    const def = PALETTES[name];
    const lines = COLOR_FIELDS.map((field) => {
      const cssVar = def.base === 'dark' ? toDarkVar(VAR_NAMES[field]) : VAR_NAMES[field];
      return `  --${cssVar}: ${hexToChannels(def[field])};`;
    });
    return `:root[data-palette='${name}'] {\n${lines.join('\n')}\n}`;
  });
  return `${blocks.join('\n\n')}\n`;
}

// @pierre/diffs re-skins its code/gutter/buffer surfaces via `--diffs-*-override` vars
// (inherited through :root). Each maps to one structural token; dark-base palettes read
// the `*-dark` form. Syntax colors stay on the pierre-light/dark Shiki themes; only these
// backgrounds are overridden so the diff matches the editor. Same source as the surface
// blocks, so adding a palette themes its diff view with no extra hand-editing.
const DIFF_OVERRIDES: Record<string, string> = {
  'bg-context': 'surface-secondary',
  'bg-buffer': 'surface',
  'bg-context-gutter': 'surface',
  'bg-separator': 'surface-tertiary',
  'fg-number': 'text-quaternary',
  'bg-hover': 'surface-hover',
  'bg-selection': 'surface-active',
  'bg-selection-number': 'surface-active',
};

// Add/delete tints are semantic, not per-palette: they mirror the success/error scale in
// tailwind.config.js (light base → 600 step, dark base → 400 step), matching the +/- count
// badges in DiffView. Only the diff's green/red rows are pulled onto our tokens so they stop
// reading as Pierre's default theme; surfaces still come from DIFF_OVERRIDES.
const DIFF_SEMANTIC_CHANNELS = {
  light: { addition: hexToChannels('#16a34a'), deletion: hexToChannels('#dc2626') },
  dark: { addition: hexToChannels('#4ade80'), deletion: hexToChannels('#f87171') },
} as const;

type DiffSemanticSide = keyof (typeof DIFF_SEMANTIC_CHANNELS)['light'];

// Pierre var (sans `--diffs-`/`-override`) → [semantic side, alpha]. Rows and gutter cells get
// a subtle tint; intra-line emphasis is stronger; number text and the accent marker are solid.
const DIFF_SEMANTIC_OVERRIDES: Record<string, readonly [DiffSemanticSide, number]> = {
  'bg-addition': ['addition', 0.15],
  'bg-deletion': ['deletion', 0.15],
  'bg-addition-emphasis': ['addition', 0.3],
  'bg-deletion-emphasis': ['deletion', 0.3],
  'bg-addition-number': ['addition', 0.15],
  'bg-deletion-number': ['deletion', 0.15],
  'fg-number-addition': ['addition', 1],
  'fg-number-deletion': ['deletion', 1],
  'addition-color': ['addition', 1],
  'deletion-color': ['deletion', 1],
};

export function generateDiffPaletteCss(): string {
  const blocks = (Object.keys(PALETTES) as (keyof typeof PALETTES)[]).map((name) => {
    const dark = PALETTES[name].base === 'dark';
    const channels = DIFF_SEMANTIC_CHANNELS[dark ? 'dark' : 'light'];
    const surfaceLines = Object.entries(DIFF_OVERRIDES).map(([diffVar, token]) => {
      const ref = dark ? toDarkVar(token) : token;
      return `  --diffs-${diffVar}-override: rgb(var(--${ref}) / 1);`;
    });
    const semanticLines = Object.entries(DIFF_SEMANTIC_OVERRIDES).map(
      ([diffVar, [side, alpha]]) =>
        `  --diffs-${diffVar}-override: rgb(${channels[side]} / ${alpha});`,
    );
    return `:root[data-palette='${name}'] {\n${[...surfaceLines, ...semanticLines].join('\n')}\n}`;
  });
  return `${blocks.join('\n\n')}\n`;
}
