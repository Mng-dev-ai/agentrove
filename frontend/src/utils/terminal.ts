import type { ITerminalOptions } from '@xterm/xterm';
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
  };
};

// Terminal tab layouts live in their own localStorage entries outside the zustand
// persist blob. The key scheme is owned here so the Container's writes and the
// uiStore's delete-time sweeps can't silently drift apart.
export const terminalStorageKey = (chatId: string, panelKey: string): string =>
  `terminal:${chatId}:${panelKey}`;

export function clearTerminalStorage(chatId?: string): void {
  // Sweep one chat's entries, or every chat's when chatId is omitted.
  const prefix = chatId ? `terminal:${chatId}:` : 'terminal:';
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
}
