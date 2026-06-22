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

export function generateDiffPaletteCss(): string {
  const blocks = (Object.keys(PALETTES) as (keyof typeof PALETTES)[]).map((name) => {
    const dark = PALETTES[name].base === 'dark';
    const lines = Object.entries(DIFF_OVERRIDES).map(([diffVar, token]) => {
      const ref = dark ? toDarkVar(token) : token;
      return `  --diffs-${diffVar}-override: rgb(var(--${ref}) / 1);`;
    });
    return `:root[data-palette='${name}'] {\n${lines.join('\n')}\n}`;
  });
  return `${blocks.join('\n\n')}\n`;
}
