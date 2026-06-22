import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Building2,
  Coffee,
  Flame,
  Ghost,
  Monitor,
  Moon,
  MoonStar,
  Snowflake,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
} from 'lucide-react';
import type { Palette, Theme } from '@/types/ui.types';
import type { PaletteDef, PaletteKey } from '@/styles/palettes';
import { PALETTES } from '@/styles/palettes';

// Palettes that aren't the plain light/dark base — each re-skins the base surfaces.
export type CustomPalette = Exclude<Palette, 'light' | 'dark'>;

export interface ThemeMeta {
  value: Theme;
  label: string;
  icon: LucideIcon;
}

// Single source for theme presentation and cycle order. A custom palette's colors +
// light/dark base live in src/styles/palettes.ts (see DARK_PALETTES). Themes are picked
// from the command menu's theme sub-mode, not per-theme chords (see commandRegistry).
export const THEMES: ThemeMeta[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dim', label: 'Dim', icon: MoonStar },
  { value: 'sepia', label: 'Sepia', icon: BookOpen },
  { value: 'solarized-light', label: 'Solarized Light', icon: Sunrise },
  { value: 'solarized-dark', label: 'Solarized Dark', icon: Sunset },
  { value: 'nord', label: 'Nord', icon: Snowflake },
  { value: 'midnight', label: 'Midnight', icon: Sparkles },
  { value: 'dracula', label: 'Dracula', icon: Ghost },
  { value: 'tokyo-night', label: 'Tokyo Night', icon: Building2 },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte', icon: Coffee },
  { value: 'ember', label: 'Ember', icon: Flame },
  { value: 'system', label: 'System', icon: Monitor },
];

const THEME_BY_VALUE = Object.fromEntries(THEMES.map((t) => [t.value, t])) as Record<
  Theme,
  ThemeMeta
>;

// Fall back to the default theme if a persisted value no longer matches a known
// theme — callers read `.icon` straight off the result and would otherwise crash.
export const getThemeMeta = (theme: Theme): ThemeMeta =>
  THEME_BY_VALUE[theme] ?? THEME_BY_VALUE.dark;

// Order the quick-toggle (header / profile menu) steps through.
export const THEME_CYCLE: Theme[] = THEMES.map((t) => t.value);

// palettes.ts declares PaletteKey locally (it must stay alias-free for the Node/vite
// tsconfig), so guard it against the Theme-derived CustomPalette here, where both are in
// scope. Typing the PaletteKey-derived keys as CustomPalette[] forces the two unions to
// match: a stray palette key fails this assignment; a theme missing its palette data fails
// the PALETTES[p] lookups below.
const CUSTOM_PALETTE_KEYS: CustomPalette[] = Object.keys(PALETTES) as PaletteKey[];

// Palettes that ride the dark base (body `dark` class + the *-dark token vars). The
// `dark` mode has no override block; every dark custom palette is read from PALETTES.
export const DARK_PALETTES: ReadonlySet<Palette> = new Set<Palette>([
  'dark',
  ...CUSTOM_PALETTE_KEYS.filter((p) => PALETTES[p].base === 'dark'),
]);

export interface PaletteTokens {
  surface: string; // deepest/page background
  surfaceSecondary: string; // raised surface (editor + terminal canvas)
  surfaceTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
}

const toTokens = (def: PaletteDef): PaletteTokens => ({
  surface: def.surface,
  surfaceSecondary: def.surfaceSecondary,
  surfaceTertiary: def.surfaceTertiary,
  textPrimary: def.textPrimary,
  textSecondary: def.textSecondary,
  textTertiary: def.textTertiary,
});

// The surface/text subset of PALETTES that Monaco, xterm, and the VisualWidget iframe
// need as hex — they can't read the CSS vars. Same source as the generated CSS, so the
// two can't drift.
export const CUSTOM_PALETTE_TOKENS = Object.fromEntries(
  CUSTOM_PALETTE_KEYS.map((p) => [p, toTokens(PALETTES[p])]),
) as Record<CustomPalette, PaletteTokens>;
