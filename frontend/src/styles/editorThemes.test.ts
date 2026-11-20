import { describe, it, expect } from 'vitest';
import { THEME_DATA } from './editorThemes';
import { PALETTES } from './palettes';
import type { PaletteKey } from './palettes';

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each(Object.keys(PALETTES) as PaletteKey[])('%s editor theme', (key) => {
  const colors = THEME_DATA[key].data.colors;
  const background = colors['editor.background'];

  it('shows the selection against the editor background', () => {
    expect(contrast(colors['editor.selectionBackground'], background)).toBeGreaterThanOrEqual(1.12);
  });

  it('keeps line numbers readable on the editor background', () => {
    expect(contrast(colors['editorLineNumber.foreground'], background)).toBeGreaterThanOrEqual(3);
  });
});
