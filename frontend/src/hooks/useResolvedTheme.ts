import { useSyncExternalStore } from 'react';
import { selectAppliedTheme, useUIStore } from '@/store/uiStore';
import { DARK_PALETTES } from '@/utils/theme';
import type { Palette, ResolvedTheme } from '@/types/ui.types';

function getMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia('(prefers-color-scheme: dark)');
}

function subscribe(callback: () => void): () => void {
  const mediaQuery = getMediaQuery();
  if (!mediaQuery) {
    return () => {};
  }

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', callback);
    return () => mediaQuery.removeEventListener('change', callback);
  }

  mediaQuery.addListener(callback);
  return () => mediaQuery.removeListener(callback);
}

function getSnapshot(): boolean {
  return getMediaQuery()?.matches ?? true;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useAppliedPalette(): Palette {
  const theme = useUIStore(selectAppliedTheme);
  const systemLightTheme = useUIStore((state) => state.systemLightTheme);
  const systemDarkTheme = useUIStore((state) => state.systemDarkTheme);
  const prefersDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (theme !== 'system') return theme;
  return prefersDark ? systemDarkTheme : systemLightTheme;
}

export function useResolvedTheme(): ResolvedTheme {
  return DARK_PALETTES.has(useAppliedPalette()) ? 'dark' : 'light';
}
