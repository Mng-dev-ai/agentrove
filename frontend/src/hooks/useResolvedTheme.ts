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
  const lightTheme = useUIStore((state) => state.lightTheme);
  const darkTheme = useUIStore((state) => state.darkTheme);
  const prefersDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (theme !== 'system') return theme;
  return prefersDark ? darkTheme : lightTheme;
}

export function useResolvedTheme(): ResolvedTheme {
  return DARK_PALETTES.has(useAppliedPalette()) ? 'dark' : 'light';
}
