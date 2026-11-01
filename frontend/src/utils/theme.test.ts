import { describe, it, expect } from 'vitest';
import type { Theme } from '@/types/ui.types';
import { THEME_CYCLE, getThemeMeta } from './theme';

describe('getThemeMeta', () => {
  it('returns the matching meta for a known theme', () => {
    expect(getThemeMeta('light')).toMatchObject({ value: 'light', label: 'Light' });
  });

  it('falls back to the dark theme for a stale persisted value', () => {
    const meta = getThemeMeta('not-a-real-theme' as Theme);
    expect(meta.value).toBe('dark');
    expect(meta.icon).toBeDefined();
  });
});

describe('THEME_CYCLE', () => {
  it('has no duplicate entries, so cycling visits every theme', () => {
    expect(new Set(THEME_CYCLE).size).toBe(THEME_CYCLE.length);
  });
});
