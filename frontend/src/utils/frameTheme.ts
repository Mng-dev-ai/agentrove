import type { CustomPalette } from '@/utils/theme';
import { CUSTOM_PALETTE_TOKENS } from '@/utils/theme';
import type { Theme } from '@/types/ui.types';

// Hex values mirror tailwind.config.js design tokens — kept in sync manually
// because sandboxed frames are separate documents with no Tailwind context.
// Names follow the MCP Apps standard host style variables.
const SHARED_VARS: Record<string, string> = {
  '--font-sans': 'system-ui, -apple-system, sans-serif',
  '--font-serif': "Georgia, 'Times New Roman', serif",
  '--font-mono': "'SF Mono', Menlo, Consolas, monospace",
  '--border-radius-md': '8px',
  '--border-radius-lg': '12px',
  '--border-radius-xl': '16px',
};

const DARK_VARS: Record<string, string> = {
  '--color-text-primary': '#ffffff',
  '--color-text-secondary': '#e0e0e0',
  '--color-text-tertiary': '#c0c0c0',
  '--color-text-info': '#60a5fa',
  '--color-text-success': '#4ade80',
  '--color-text-warning': '#fbbf24',
  '--color-text-danger': '#f87171',
  '--color-background-primary': '#0a0a0a',
  '--color-background-secondary': '#141414',
  '--color-background-tertiary': '#1e1e1e',
  '--color-background-info': '#1e3a8a',
  '--color-background-success': '#14532d',
  '--color-background-warning': '#78350f',
  '--color-background-danger': '#7f1d1d',
  '--color-border-primary': 'rgba(255,255,255,0.4)',
  '--color-border-secondary': 'rgba(255,255,255,0.3)',
  '--color-border-tertiary': 'rgba(255,255,255,0.15)',
  '--color-border-info': '#3b82f6',
  ...SHARED_VARS,
};

const LIGHT_VARS: Record<string, string> = {
  '--color-text-primary': '#0f172a',
  '--color-text-secondary': '#475569',
  '--color-text-tertiary': '#64748b',
  '--color-text-info': '#2563eb',
  '--color-text-success': '#16a34a',
  '--color-text-warning': '#d97706',
  '--color-text-danger': '#dc2626',
  '--color-background-primary': '#f5f5f5',
  '--color-background-secondary': '#f9f9f9',
  '--color-background-tertiary': '#f3f3f3',
  '--color-background-info': '#eff6ff',
  '--color-background-success': '#f0fdf4',
  '--color-background-warning': '#fffbeb',
  '--color-background-danger': '#fef2f2',
  '--color-border-primary': 'rgba(0,0,0,0.4)',
  '--color-border-secondary': 'rgba(0,0,0,0.3)',
  '--color-border-tertiary': 'rgba(0,0,0,0.15)',
  '--color-border-info': '#2563eb',
  ...SHARED_VARS,
};

// Custom palettes only diverge in the structural surface/text tokens — they inherit
// the base dark/light semantic colors and borders.
const PALETTE_OVERRIDES = Object.fromEntries(
  (Object.keys(CUSTOM_PALETTE_TOKENS) as CustomPalette[]).map((palette) => {
    const t = CUSTOM_PALETTE_TOKENS[palette];
    return [
      palette,
      {
        '--color-text-primary': t.textPrimary,
        '--color-text-secondary': t.textSecondary,
        '--color-text-tertiary': t.textTertiary,
        '--color-background-primary': t.surface,
        '--color-background-secondary': t.surfaceSecondary,
        '--color-background-tertiary': t.surfaceTertiary,
      },
    ];
  }),
) as Partial<Record<Theme, Record<string, string>>>;

export const FRAME_BASE_CSS = `
  button { background: transparent; border: 0.5px solid var(--color-border-secondary); border-radius: var(--border-radius-md); padding: 6px 14px; font-size: 13px; color: var(--color-text-primary); cursor: pointer; font-family: var(--font-sans); }
  button:hover { background: var(--color-background-secondary); }
  input[type="range"] { -webkit-appearance: none; height: 4px; background: var(--color-border-tertiary); border-radius: 2px; }
  input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--color-background-primary); border: 0.5px solid var(--color-border-secondary); cursor: pointer; }
  select { background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 6px 10px; font-size: 13px; color: var(--color-text-primary); font-family: var(--font-sans); }
  input[type="text"], input[type="number"] { background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 6px 10px; font-size: 13px; color: var(--color-text-primary); font-family: var(--font-sans); }
  * { box-sizing: border-box; margin: 0; font-family: var(--font-sans); }
  body { background: transparent; color: var(--color-text-primary); line-height: 1.5; padding: 1rem; }
`;

export const getFrameThemeVariables = (isDark: boolean, theme: Theme): Record<string, string> => ({
  ...(isDark ? DARK_VARS : LIGHT_VARS),
  ...PALETTE_OVERRIDES[theme],
});
