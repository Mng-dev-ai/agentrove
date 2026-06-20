import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
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

// Palettes that aren't the plain light/dark base — each re-skins the base surfaces.
export type CustomPalette = Exclude<Palette, 'light' | 'dark'>;

export interface ThemeMeta {
  value: Theme;
  label: string;
  icon: LucideIcon;
  // Base the palette rides; null for `system`, which follows the OS.
  base: 'dark' | 'light' | null;
  // Command-menu shortcut letter (Cmd/Ctrl+Shift+<key>).
  shortcut: string;
}

// Single source for theme presentation, cycle order, and command shortcut. Adding a
// custom palette also needs: a `CUSTOM_PALETTE_TOKENS` entry (hex, below) AND a
// `data-palette` block in globals.css (RGB channels — the copy that does the theming).
export const THEMES: ThemeMeta[] = [
  { value: 'dark', label: 'Dark', icon: Moon, base: 'dark', shortcut: 'm' },
  { value: 'light', label: 'Light', icon: Sun, base: 'light', shortcut: 'g' },
  { value: 'dim', label: 'Dim', icon: MoonStar, base: 'dark', shortcut: 'i' },
  { value: 'sepia', label: 'Sepia', icon: BookOpen, base: 'light', shortcut: 'p' },
  {
    value: 'solarized-light',
    label: 'Solarized Light',
    icon: Sunrise,
    base: 'light',
    shortcut: 'q',
  },
  { value: 'solarized-dark', label: 'Solarized Dark', icon: Sunset, base: 'dark', shortcut: 'r' },
  { value: 'nord', label: 'Nord', icon: Snowflake, base: 'dark', shortcut: 'v' },
  { value: 'midnight', label: 'Midnight', icon: Sparkles, base: 'dark', shortcut: 'x' },
  { value: 'system', label: 'System', icon: Monitor, base: null, shortcut: 'y' },
];

const THEME_BY_VALUE = Object.fromEntries(THEMES.map((t) => [t.value, t])) as Record<
  Theme,
  ThemeMeta
>;

export const getThemeMeta = (theme: Theme): ThemeMeta => THEME_BY_VALUE[theme];

// Order the quick-toggle (header / profile menu) steps through.
export const THEME_CYCLE: Theme[] = THEMES.map((t) => t.value);

// Palettes that ride the dark base (body `dark` class + the *-dark token vars).
// Single source for dark/light classification.
export const DARK_PALETTES: ReadonlySet<Palette> = new Set<Palette>(
  THEMES.filter((t) => t.base === 'dark').map((t) => t.value as Palette),
);

export interface PaletteTokens {
  surface: string; // deepest/page background
  surfaceSecondary: string; // raised surface (editor + terminal canvas)
  surfaceTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
}

// Structural colors for the custom palettes — a hex mirror of the data-palette blocks
// in globals.css (the CSS-native copy, in RGB channels). Monaco, xterm, and the
// VisualWidget iframe can't read CSS vars, so they project these instead. Trap: the two
// copies are different formats (#1c1c1e here vs `28 28 30` there) with no check that
// they agree — change a shade in both, and convert correctly.
export const CUSTOM_PALETTE_TOKENS: Record<CustomPalette, PaletteTokens> = {
  dim: {
    surface: '#1c1c1e',
    surfaceSecondary: '#242426',
    surfaceTertiary: '#2f2f31',
    textPrimary: '#e4e4e6',
    textSecondary: '#b8b8bd',
    textTertiary: '#8a8a90',
  },
  sepia: {
    surface: '#f4ecd8',
    surfaceSecondary: '#faf3e0',
    surfaceTertiary: '#efe6cf',
    textPrimary: '#4b3a2a',
    textSecondary: '#6f5942',
    textTertiary: '#9a8366',
  },
  'solarized-light': {
    surface: '#f4edda',
    surfaceSecondary: '#fdf6e3',
    surfaceTertiary: '#eee8d5',
    textPrimary: '#073642',
    textSecondary: '#586e75',
    textTertiary: '#657b83',
  },
  'solarized-dark': {
    surface: '#002b36',
    surfaceSecondary: '#073642',
    surfaceTertiary: '#0a4453',
    textPrimary: '#eee8d5',
    textSecondary: '#93a1a1',
    textTertiary: '#839496',
  },
  nord: {
    surface: '#2a2f3a',
    surfaceSecondary: '#2e3440',
    surfaceTertiary: '#3b4252',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    textTertiary: '#a3acbd',
  },
  midnight: {
    surface: '#0b1020',
    surfaceSecondary: '#0f1530',
    surfaceTertiary: '#172145',
    textPrimary: '#e6ecff',
    textSecondary: '#aebbd8',
    textTertiary: '#7384a8',
  },
};
