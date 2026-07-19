import type { ITerminalOptions } from '@xterm/xterm';
import type { ISearchDecorationOptions } from '@xterm/addon-search';
import type { Palette } from '@/types/ui.types';
import { CUSTOM_PALETTE_TOKENS, DARK_PALETTES } from '@/utils/theme';

// xterm paints its own canvas background, so it can't read the surface-secondary CSS
// var. Custom palettes derive bg/fg from the shared tokens; light/dark are the base
// shades (mirrored from globals.css).
const BASE_SURFACE = {
  light: { background: '#f9f9f9', foreground: '#27272a' },
  dark: { background: '#141414', foreground: '#e4e4e7' },
} as const;

function paletteSurface(palette: Palette): { background: string; foreground: string } {
  if (palette === 'light' || palette === 'dark') return BASE_SURFACE[palette];
  const t = CUSTOM_PALETTE_TOKENS[palette];
  return { background: t.surfaceSecondary, foreground: t.textPrimary };
}

// xterm's built-in ANSI 16 defaults assume a dark background — on a light canvas,
// white/bright-white and yellow output (git, ls, prompts) is near-invisible. Light
// palettes get VS Code Light+'s re-tuned set; dark palettes keep the built-ins.
const LIGHT_ANSI = {
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
} as const;

export const buildTerminalTheme = (palette: Palette): ITerminalOptions['theme'] => {
  const isDark = DARK_PALETTES.has(palette);
  const { background, foreground } = paletteSurface(palette);
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: isDark ? '#0a0a0a' : '#ffffff',
    selectionBackground: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)',
    selectionInactiveBackground: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
    ...(isDark ? null : LIGHT_ANSI),
  };
};

export const buildSearchDecorations = (palette: Palette): ISearchDecorationOptions => {
  // Opaque #RRGGBB only — xterm drops the alpha byte and paints the cell
  // background solid, so the grays must keep the theme foreground readable.
  const isDark = DARK_PALETTES.has(palette);
  return {
    matchBackground: isDark ? '#3f3f46' : '#d4d4d8',
    activeMatchBackground: isDark ? '#71717a' : '#a1a1aa',
    matchOverviewRuler: isDark ? '#71717a' : '#a1a1aa',
    activeMatchColorOverviewRuler: isDark ? '#e4e4e7' : '#27272a',
  };
};

// Terminal tab layouts live in their own localStorage entries outside the zustand
// persist blob. The key scheme is owned here so the Container's writes and the
// uiStore's delete-time sweeps can't silently drift apart. The scope is a chat id,
// or a `landing-<sandboxId>` scope for pre-chat terminals (those are only swept by
// the clear-all path).
export const terminalStorageKey = (scope: string, panelKey: string): string =>
  `terminal:${scope}:${panelKey}`;

export function clearTerminalStorage(chatId?: string): void {
  // Sweep one chat's entries, or every chat's when chatId is omitted.
  const prefix = chatId ? `terminal:${chatId}:` : 'terminal:';
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
}
