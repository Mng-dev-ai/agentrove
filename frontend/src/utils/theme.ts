import type { LucideIcon } from 'lucide-react';
import {
  Binary,
  BookOpen,
  Building2,
  Cherry,
  Code2,
  Coffee,
  Command,
  Eclipse,
  Flame,
  Flower2,
  Ghost,
  Github,
  Heart,
  Laptop,
  Layers,
  Monitor,
  Moon,
  MoonStar,
  Mountain,
  NotepadText,
  Shell,
  Snowflake,
  Sparkles,
  Sun,
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
  { value: 'sepia', label: 'Sepia', icon: BookOpen },
  { value: 'solarized-light', label: 'Solarized Light', icon: Sunrise },
  { value: 'solarized-dark', label: 'Solarized Dark', icon: Sunset },
  { value: 'nord', label: 'Nord', icon: Snowflake },
  { value: 'midnight', label: 'Midnight', icon: Sparkles },
  { value: 'dracula', label: 'Dracula', icon: Ghost },
  { value: 'tokyo-night', label: 'Tokyo Night', icon: Building2 },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte', icon: Coffee },
  { value: 'catppuccin-mocha', label: 'Catppuccin Mocha', icon: Cherry },
  { value: 'ember', label: 'Ember', icon: Flame },
  { value: 'gruvbox', label: 'Gruvbox', icon: Mountain },
  { value: 'rose-pine', label: 'Rosé Pine', icon: Flower2 },
  { value: 'rose-pine-dawn', label: 'Rosé Pine Dawn', icon: Heart },
  { value: 'everforest', label: 'Everforest', icon: TreePine },
  { value: 'kanagawa', label: 'Kanagawa', icon: Waves },
  { value: 'one-dark', label: 'One Dark', icon: Eclipse },
  { value: 'cyberpunk', label: 'Cyberpunk', icon: Zap },
  { value: 'vercel', label: 'Vercel', icon: Triangle },
  { value: 'github', label: 'GitHub', icon: Github },
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

// Stale persisted themes fall back so callers reading `.icon` don't crash.
export const getThemeMeta = (theme: Theme): ThemeMeta =>
  THEME_BY_VALUE[theme] ?? THEME_BY_VALUE.dark;

export const THEME_CYCLE: Theme[] = THEMES.map((t) => t.value);

// PaletteKey (alias-free for vite/node tsconfig) must match CustomPalette here.
const CUSTOM_PALETTE_KEYS: CustomPalette[] = Object.keys(PALETTES) as PaletteKey[];

// Dark base (body `dark` class + *-dark tokens). Custom darks come from PALETTES.
export const DARK_PALETTES: ReadonlySet<Palette> = new Set<Palette>([
  'dark',
  ...CUSTOM_PALETTE_KEYS.filter((p) => PALETTES[p].base === 'dark'),
]);

export interface PaletteTokens {
  surface: string; // deepest/page background
  surfaceSecondary: string; // raised (editor + terminal canvas)
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

// Hex tokens for Monaco/xterm/VisualWidget (they can't read CSS vars).
export const CUSTOM_PALETTE_TOKENS = Object.fromEntries(
  CUSTOM_PALETTE_KEYS.map((p) => [p, toTokens(PALETTES[p])]),
) as Record<CustomPalette, PaletteTokens>;
