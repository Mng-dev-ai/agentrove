// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTerminalTheme, terminalStorageKey, clearTerminalStorage } from './terminal';
import { CUSTOM_PALETTE_TOKENS } from '@/utils/theme';

describe('buildTerminalTheme', () => {
  it('overrides the ANSI colors only for light palettes', () => {
    const light = buildTerminalTheme('light');
    const dark = buildTerminalTheme('dark');

    expect(light?.white).toBeDefined();
    expect(light?.brightYellow).toBeDefined();
    expect(dark?.white).toBeUndefined();
    expect(dark?.brightYellow).toBeUndefined();
    expect(light?.background).not.toBe(dark?.background);
    expect(light?.cursorAccent).not.toBe(dark?.cursorAccent);
  });

  it('draws the cursor in the foreground color', () => {
    for (const palette of ['light', 'dark', 'nord'] as const) {
      const theme = buildTerminalTheme(palette);
      expect(theme?.cursor).toBe(theme?.foreground);
    }
  });

  it.each([
    ['dim', 'dark'],
    ['sepia', 'light'],
  ] as const)('derives the %s surface from its tokens with %s-base accents', (palette, base) => {
    const theme = buildTerminalTheme(palette);
    const baseTheme = buildTerminalTheme(base);

    expect(theme?.background).toBe(CUSTOM_PALETTE_TOKENS[palette].surfaceSecondary);
    expect(theme?.foreground).toBe(CUSTOM_PALETTE_TOKENS[palette].textPrimary);
    expect(theme?.cursorAccent).toBe(baseTheme?.cursorAccent);
    expect(theme?.selectionBackground).toBe(baseTheme?.selectionBackground);
    expect(theme?.white).toBe(baseTheme?.white);
  });
});

describe('clearTerminalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(terminalStorageKey('c1', 'main'), '1');
    localStorage.setItem(terminalStorageKey('c1', 'side'), '1');
    localStorage.setItem(terminalStorageKey('c2', 'main'), '1');
    localStorage.setItem(terminalStorageKey('landing-sb1', 'main'), '1');
    localStorage.setItem('unrelated:c1', '1');
  });

  it('sweeps only the given chat and leaves other entries', () => {
    clearTerminalStorage('c1');
    expect(localStorage.getItem(terminalStorageKey('c1', 'main'))).toBeNull();
    expect(localStorage.getItem(terminalStorageKey('c1', 'side'))).toBeNull();
    expect(localStorage.getItem(terminalStorageKey('c2', 'main'))).toBe('1');
    expect(localStorage.getItem('unrelated:c1')).toBe('1');
  });

  it('sweeps every terminal entry, including landing scopes, when no chat id is given', () => {
    clearTerminalStorage();
    expect(localStorage.getItem(terminalStorageKey('c1', 'main'))).toBeNull();
    expect(localStorage.getItem(terminalStorageKey('c2', 'main'))).toBeNull();
    expect(localStorage.getItem(terminalStorageKey('landing-sb1', 'main'))).toBeNull();
    expect(localStorage.getItem('unrelated:c1')).toBe('1');
  });
});
