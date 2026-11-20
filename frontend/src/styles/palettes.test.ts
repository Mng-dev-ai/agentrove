import { describe, it, expect } from 'vitest';
import { PALETTES } from './palettes';

const SURFACES = [
  'surface',
  'surfaceSecondary',
  'surfaceTertiary',
  'surfaceHover',
  'surfaceActive',
] as const;
const TEXT_TIERS = ['textPrimary', 'textSecondary', 'textTertiary', 'textQuaternary'] as const;

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each(Object.entries(PALETTES))('%s palette', (_, palette) => {
  it('meets the text contrast contract', () => {
    for (const surface of SURFACES) {
      expect(contrast(palette.textSecondary, palette[surface])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.textTertiary, palette[surface])).toBeGreaterThanOrEqual(3);
    }
    for (const surface of SURFACES.slice(0, 3)) {
      expect(contrast(palette.textQuaternary, palette[surface])).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps text tiers monotonic against the surface', () => {
    const ratios = TEXT_TIERS.map((tier) => contrast(palette[tier], palette.surface));
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
  });

  it('keeps the border distinct from the tertiary surface', () => {
    expect(palette.border).not.toBe(palette.surfaceTertiary);
  });
});
