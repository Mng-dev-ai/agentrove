import { describe, it, expect } from 'vitest';
import type { Theme } from '@/types/ui.types';
import { THEMES, THEME_CYCLE, getThemeMeta, DARK_PALETTES } from './theme';

describe('getThemeMeta', () => {
  it('returns the matching meta for a known theme', () => {
    const meta = getThemeMeta('light');
    expect(meta.value).toBe('light');
    expect(meta.label).toBe('Light');
    expect(meta.icon).toBeDefined();
  });

  it('falls back to the dark theme for an unknown value', () => {
    // A stale persisted theme must not crash callers reading `.icon`.
    const meta = getThemeMeta('not-a-real-theme' as Theme);
    expect(meta.value).toBe('dark');
  });
});

describe('THEME_CYCLE', () => {
  it('mirrors THEMES order exactly', () => {
    expect(THEME_CYCLE).toEqual(THEMES.map((t) => t.value));
  });

  it('has no duplicate entries', () => {
    expect(new Set(THEME_CYCLE).size).toBe(THEME_CYCLE.length);
  });
});

describe('DARK_PALETTES', () => {
  it('always includes the base dark palette and excludes light', () => {
    expect(DARK_PALETTES.has('dark')).toBe(true);
    expect(DARK_PALETTES.has('light')).toBe(false);
  });
});
