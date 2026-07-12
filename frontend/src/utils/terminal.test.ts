// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTerminalTheme, terminalStorageKey, clearTerminalStorage } from './terminal';
import { CUSTOM_PALETTE_TOKENS } from '@/utils/theme';

describe('terminalStorageKey', () => {
  it('joins chat id and panel key under the terminal namespace', () => {
    expect(terminalStorageKey('chat-1', 'main')).toBe('terminal:chat-1:main');
  });
});

describe('buildTerminalTheme', () => {
  it('uses the light base surface and light-mode accents for light', () => {
    const theme = buildTerminalTheme('light');
    expect(theme).toMatchObject({
      background: '#f9f9f9',
      foreground: '#27272a',
      cursor: '#27272a',
      cursorAccent: '#ffffff',
      selectionBackground: 'rgba(0, 0, 0, 0.15)',
      selectionInactiveBackground: 'rgba(0, 0, 0, 0.08)',
    });
    // Light palettes override the ANSI 16 — the built-ins are dark-background colors.
    expect(theme?.white).toBe('#555555');
    expect(theme?.brightYellow).toBe('#b5ba00');
  });

  it('uses the dark base surface and dark-mode accents for dark', () => {
    const theme = buildTerminalTheme('dark');
    expect(theme).toMatchObject({
      background: '#141414',
      foreground: '#e4e4e7',
      cursorAccent: '#0a0a0a',
      selectionBackground: 'rgba(255, 255, 255, 0.2)',
    });
    // Dark palettes keep xterm's built-in ANSI defaults.
    expect(theme?.white).toBeUndefined();
  });

  it('derives a dark custom palette from its shared tokens', () => {
    const theme = buildTerminalTheme('dim');
    expect(theme?.background).toBe(CUSTOM_PALETTE_TOKENS.dim.surfaceSecondary);
    expect(theme?.foreground).toBe(CUSTOM_PALETTE_TOKENS.dim.textPrimary);
    // dim rides the dark base -> dark cursor accent.
    expect(theme?.cursorAccent).toBe('#0a0a0a');
  });

  it('derives a light custom palette with light-mode accents', () => {
    const theme = buildTerminalTheme('sepia');
    expect(theme?.background).toBe(CUSTOM_PALETTE_TOKENS.sepia.surfaceSecondary);
    expect(theme?.foreground).toBe(CUSTOM_PALETTE_TOKENS.sepia.textPrimary);
    expect(theme?.cursorAccent).toBe('#ffffff');
  });
});

describe('clearTerminalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('terminal:c1:main', '1');
    localStorage.setItem('terminal:c1:side', '1');
    localStorage.setItem('terminal:c2:main', '1');
    localStorage.setItem('unrelated:c1', '1');
  });

  it('sweeps only the given chat and leaves other entries', () => {
    clearTerminalStorage('c1');
    expect(localStorage.getItem('terminal:c1:main')).toBeNull();
    expect(localStorage.getItem('terminal:c1:side')).toBeNull();
    expect(localStorage.getItem('terminal:c2:main')).toBe('1');
    expect(localStorage.getItem('unrelated:c1')).toBe('1');
  });

  it('sweeps every terminal entry when no chat id is given', () => {
    clearTerminalStorage();
    expect(localStorage.getItem('terminal:c1:main')).toBeNull();
    expect(localStorage.getItem('terminal:c2:main')).toBeNull();
    expect(localStorage.getItem('unrelated:c1')).toBe('1');
  });
});
