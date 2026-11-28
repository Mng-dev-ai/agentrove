import type { LucideIcon } from 'lucide-react';
import {
  Binary,
  Bird,
  BookOpen,
  Building2,
  Candy,
  Cherry,
  CloudMoon,
  CloudSun,
  Code2,
  Coffee,
  Command,
  Contrast,
  Eclipse,
  Flame,
  Flower2,
  Ghost,
  GitFork,
  Github,
  Heart,
  Laptop,
  Layers,
  Monitor,
  Moon,
  MoonStar,
  Mountain,
  MountainSnow,
  NotepadText,
  Orbit,
  Shell,
  Snowflake,
  Sparkles,
  Sun,
  SunDim,
  SunMedium,
  Sunrise,
  Sunset,
  TreePine,
  Triangle,
  Waves,
  Zap,
} from 'lucide-react';
import type { Palette, Theme } from '@/types/ui.types';
import type { PaletteDef, PaletteKey } from '@/styles/palettes';
import { PALETTES } from '@/styles/palettes';

export type CustomPalette = Exclude<Palette, 'light' | 'dark'>;

export interface ThemeMeta {
  value: Theme;
  label: string;
  icon: LucideIcon;
}

// Theme presentation + cycle order. Palette colors live in src/styles/palettes.ts.
export const THEMES: ThemeMeta[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dim', label: 'Dim', icon: MoonStar },
  { value: 'high-contrast', label: 'High Contrast', icon: Contrast },
  { value: 'high-contrast-light', label: 'High Contrast Light', icon: SunMedium },
  { value: 'sepia', label: 'Sepia', icon: BookOpen },
  { value: 'solarized-light', label: 'Solarized Light', icon: Sunrise },
  { value: 'solarized-dark', label: 'Solarized Dark', icon: Sunset },
  { value: 'nord', label: 'Nord', icon: Snowflake },
  { value: 'midnight', label: 'Midnight', icon: Sparkles },
  { value: 'dracula', label: 'Dracula', icon: Ghost },
  { value: 'monokai', label: 'Monokai', icon: Candy },
  { value: 'tokyo-night', label: 'Tokyo Night', icon: Building2 },
  { value: 'night-owl', label: 'Night Owl', icon: Bird },
  { value: 'palenight', label: 'Palenight', icon: Orbit },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte', icon: Coffee },
  { value: 'catppuccin-mocha', label: 'Catppuccin Mocha', icon: Cherry },
  { value: 'ember', label: 'Ember', icon: Flame },
  { value: 'gruvbox', label: 'Gruvbox', icon: Mountain },
  { value: 'gruvbox-light', label: 'Gruvbox Light', icon: MountainSnow },
  { value: 'rose-pine', label: 'Rosé Pine', icon: Flower2 },
  { value: 'rose-pine-dawn', label: 'Rosé Pine Dawn', icon: Heart },
  { value: 'everforest', label: 'Everforest', icon: TreePine },
  { value: 'kanagawa', label: 'Kanagawa', icon: Waves },
  { value: 'one-dark', label: 'One Dark', icon: Eclipse },
  { value: 'one-light', label: 'One Light', icon: SunDim },
  { value: 'ayu-dark', label: 'Ayu Dark', icon: CloudMoon },
  { value: 'ayu-light', label: 'Ayu Light', icon: CloudSun },
  { value: 'cyberpunk', label: 'Cyberpunk', icon: Zap },
  { value: 'vercel', label: 'Vercel', icon: Triangle },
  { value: 'github', label: 'GitHub', icon: Github },
  { value: 'github-light', label: 'GitHub Light', icon: GitFork },
  { value: 'vscode-plus', label: 'VS Code+', icon: Code2 },
  { value: 'xcode', label: 'Xcode', icon: Laptop },
  { value: 'raycast', label: 'Raycast', icon: Command },
  { value: 'notion', label: 'Notion', icon: NotepadText },
  { value: 'matrix', label: 'Matrix', icon: Binary },
  { value: 'linear', label: 'Linear', icon: Layers },
  { value: 'lobster', label: 'Lobster', icon: Shell },
  { value: 'system', label: 'System', icon: Monitor },
];

const THEME_BY_VALUE = Object.fromEntries(THEMES.map((t) => [t.value, t])) as Record<
  Theme,
  ThemeMeta
>;

export type PaletteMeta = ThemeMeta & { value: Palette };

// Stale persisted themes fall back so callers reading `.icon` don't crash.
export function getThemeMeta(theme: Palette): PaletteMeta;
export function getThemeMeta(theme: Theme): ThemeMeta;
export function getThemeMeta(theme: Theme): ThemeMeta {
  return THEME_BY_VALUE[theme] ?? THEME_BY_VALUE.dark;
}

export const THEME_CYCLE: Theme[] = THEMES.map((t) => t.value);

// PaletteKey (alias-free for vite/node tsconfig) must match CustomPalette here.
const CUSTOM_PALETTE_KEYS: CustomPalette[] = Object.keys(PALETTES) as PaletteKey[];

// Dark base (body `dark` class + *-dark tokens). Custom darks come from PALETTES.
export const DARK_PALETTES: ReadonlySet<Palette> = new Set<Palette>([
  'dark',
  ...CUSTOM_PALETTE_KEYS.filter((p) => PALETTES[p].base === 'dark'),
]);

interface PaletteTokens {
  surface: string; // deepest/page background
  surfaceSecondary: string; // raised (editor + terminal canvas)
  surfaceTertiary: string;
  surfaceActive: string;
  borderHover: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
}

const toTokens = (def: PaletteDef): PaletteTokens => ({
  surface: def.surface,
  surfaceSecondary: def.surfaceSecondary,
  surfaceTertiary: def.surfaceTertiary,
  surfaceActive: def.surfaceActive,
  borderHover: def.borderHover,
  textPrimary: def.textPrimary,
  textSecondary: def.textSecondary,
  textTertiary: def.textTertiary,
});

// Hex tokens for xterm and sandboxed frames (they can't read CSS vars).
export const CUSTOM_PALETTE_TOKENS = Object.fromEntries(
  CUSTOM_PALETTE_KEYS.map((p) => [p, toTokens(PALETTES[p])]),
) as Record<CustomPalette, PaletteTokens>;

// The plain bases' --surface*/--border-hover/--text-* channels in styles/globals/_colors.scss.
const BASE_PALETTE_TOKENS: Record<'light' | 'dark', PaletteTokens> = {
  light: {
    surface: '#f5f5f5',
    surfaceSecondary: '#f9f9f9',
    surfaceTertiary: '#f3f3f3',
    surfaceActive: '#d8d8d8',
    borderHover: '#9a9a9a',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textTertiary: '#64748b',
  },
  dark: {
    surface: '#111111',
    surfaceSecondary: '#141414',
    surfaceTertiary: '#1e1e1e',
    surfaceActive: '#323232',
    borderHover: '#404040',
    textPrimary: '#ffffff',
    textSecondary: '#e0e0e0',
    textTertiary: '#c0c0c0',
  },
};

export const PALETTE_TOKENS: Record<Palette, PaletteTokens> = {
  ...BASE_PALETTE_TOKENS,
  ...CUSTOM_PALETTE_TOKENS,
};
