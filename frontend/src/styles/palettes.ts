// Single source of truth for the custom-palette colors. Pure data (hex) with no runtime
// deps AND no app path aliases (`@/…`): vite.config imports this file, which pulls it into
// the Node tsconfig (tsconfig.node.json) that has no alias resolution. So the key type is
// declared locally instead of importing CustomPalette from theme.ts — theme.ts cross-checks
// PaletteKey against the Theme union so the two can't drift.
// `base` picks which var set a palette overrides: light vars or the `*-dark` vars.
// TODO: the data-palette CSS is generated once at Vite config load, so editing a color here
// needs a dev-server restart to show up (build/prod regenerate fine). Wire ssrLoadModule +
// handleHotUpdate into the plugin if live color tweaking becomes common.

// The custom palettes — the Theme union minus the plain light/dark/system base modes.
export type PaletteKey =
  | 'dim'
  | 'sepia'
  | 'solarized-light'
  | 'solarized-dark'
  | 'nord'
  | 'midnight'
  | 'dracula'
  | 'tokyo-night'
  | 'catppuccin-latte'
  | 'ember';

export interface PaletteDef {
  base: 'light' | 'dark';
  surface: string;
  surfaceSecondary: string;
  surfaceTertiary: string;
  surfaceHover: string;
  surfaceActive: string;
  border: string;
  borderSecondary: string;
  borderHover: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textQuaternary: string;
}

export const PALETTES: Record<PaletteKey, PaletteDef> = {
  dim: {
    base: 'dark',
    surface: '#1c1c1e',
    surfaceSecondary: '#242426',
    surfaceTertiary: '#2f2f31',
    surfaceHover: '#38383a',
    surfaceActive: '#424246',
    border: '#38383a',
    borderSecondary: '#434346',
    borderHover: '#525257',
    textPrimary: '#e4e4e6',
    textSecondary: '#b8b8bd',
    textTertiary: '#8a8a90',
    textQuaternary: '#6a6a70',
  },
  sepia: {
    base: 'light',
    surface: '#f4ecd8',
    surfaceSecondary: '#faf3e0',
    surfaceTertiary: '#efe6cf',
    surfaceHover: '#e6d9ba',
    surfaceActive: '#dccda6',
    border: '#ddd0b0',
    borderSecondary: '#d0c098',
    borderHover: '#b8a472',
    textPrimary: '#4b3a2a',
    textSecondary: '#6f5942',
    textTertiary: '#9a8366',
    textQuaternary: '#b3a07f',
  },
  'solarized-light': {
    base: 'light',
    surface: '#f4edda',
    surfaceSecondary: '#fdf6e3',
    surfaceTertiary: '#eee8d5',
    surfaceHover: '#e7e0c8',
    surfaceActive: '#ddd6bd',
    border: '#ded8c3',
    borderSecondary: '#ccc4a8',
    borderHover: '#b8ae8c',
    textPrimary: '#073642',
    textSecondary: '#586e75',
    textTertiary: '#657b83',
    textQuaternary: '#93a1a1',
  },
  'solarized-dark': {
    base: 'dark',
    surface: '#002b36',
    surfaceSecondary: '#073642',
    surfaceTertiary: '#0a4453',
    surfaceHover: '#0d4f60',
    surfaceActive: '#105a6e',
    border: '#0d4d5e',
    borderSecondary: '#135f73',
    borderHover: '#1a7088',
    textPrimary: '#eee8d5',
    textSecondary: '#93a1a1',
    textTertiary: '#839496',
    textQuaternary: '#657b83',
  },
  nord: {
    base: 'dark',
    surface: '#2a2f3a',
    surfaceSecondary: '#2e3440',
    surfaceTertiary: '#3b4252',
    surfaceHover: '#434c5e',
    surfaceActive: '#4c566a',
    border: '#3b4252',
    borderSecondary: '#434c5e',
    borderHover: '#4c566a',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    textTertiary: '#a3acbd',
    textQuaternary: '#7b8494',
  },
  midnight: {
    base: 'dark',
    surface: '#0b1020',
    surfaceSecondary: '#0f1530',
    surfaceTertiary: '#172145',
    surfaceHover: '#1e2a55',
    surfaceActive: '#243266',
    border: '#1e2a4a',
    borderSecondary: '#2a3a64',
    borderHover: '#3a4d80',
    textPrimary: '#e6ecff',
    textSecondary: '#aebbd8',
    textTertiary: '#7384a8',
    textQuaternary: '#56688c',
  },
  dracula: {
    base: 'dark',
    surface: '#21222c',
    surfaceSecondary: '#282a36',
    surfaceTertiary: '#343746',
    surfaceHover: '#424450',
    surfaceActive: '#44475a',
    border: '#343746',
    borderSecondary: '#424450',
    borderHover: '#6272a4',
    textPrimary: '#f8f8f2',
    textSecondary: '#c8cadc',
    textTertiary: '#989fbd',
    textQuaternary: '#6272a4',
  },
  'tokyo-night': {
    base: 'dark',
    surface: '#16161e',
    surfaceSecondary: '#1a1b26',
    surfaceTertiary: '#24283b',
    surfaceHover: '#2d3249',
    surfaceActive: '#363c57',
    border: '#24283b',
    borderSecondary: '#2d3249',
    borderHover: '#414868',
    textPrimary: '#c0caf5',
    textSecondary: '#a9b1d6',
    textTertiary: '#787c99',
    textQuaternary: '#565f89',
  },
  'catppuccin-latte': {
    base: 'light',
    surface: '#e6e9ef',
    surfaceSecondary: '#eff1f5',
    surfaceTertiary: '#dce0e8',
    surfaceHover: '#ccd0da',
    surfaceActive: '#bcc0cc',
    border: '#dce0e8',
    borderSecondary: '#caced8',
    borderHover: '#9ca0b0',
    textPrimary: '#4c4f69',
    textSecondary: '#5c5f77',
    textTertiary: '#8c8fa1',
    textQuaternary: '#9ca0b0',
  },
  ember: {
    base: 'dark',
    surface: '#1a1310',
    surfaceSecondary: '#211813',
    surfaceTertiary: '#2e211a',
    surfaceHover: '#3a2a20',
    surfaceActive: '#4a3528',
    border: '#3a2a20',
    borderSecondary: '#4a3528',
    borderHover: '#6b4a32',
    textPrimary: '#f5e6d8',
    textSecondary: '#e0b894',
    textTertiary: '#b3835f',
    textQuaternary: '#856249',
  },
};
