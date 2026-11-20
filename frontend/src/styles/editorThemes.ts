// Editor syntax colours and the contrast floor shared by the Monaco theme and the diff view.
import type * as monaco from 'monaco-editor';
import type { PaletteDef, PaletteKey } from './palettes';
import { PALETTES } from './palettes';

type Rgb = [number, number, number];
type Matrix = [Rgb, Rgb, Rgb];
type Syntax = Record<SyntaxToken, string>;
export type SyntaxToken = (typeof SYNTAX_TOKENS)[number];
type EditorThemeName = 'light' | 'dark' | PaletteKey;

export interface EditorTheme {
  data: monaco.editor.IStandaloneThemeData;
  // Floored on the editor background; `plain` is untokenized code text.
  syntax: Syntax;
  // The theme's primary text: the lightness tokens move toward to clear the floor.
  text: string;
}

const SYNTAX_TOKENS = [
  'plain',
  'comment',
  'keyword',
  'string',
  'number',
  'type',
  'variable',
  'function',
] as const;

const CODE_FLOOR = 4.5;
const COMMENT_FLOOR = 3;
const LIGHTNESS_STEP = 0.5;

const LIGHT_SYNTAX: Syntax = {
  plain: '#24292E',
  comment: '#8B949E',
  keyword: '#6B4C9A',
  string: '#4A6B3F',
  number: '#6B4C9A',
  type: '#5A5A5A',
  variable: '#24292E',
  function: '#3D3D3D',
};

const DARK_SYNTAX: Syntax = {
  plain: '#B0B0B0',
  comment: '#555555',
  keyword: '#9B8ABF',
  string: '#A3B38B',
  number: '#9B8ABF',
  type: '#8A8A8A',
  variable: '#B0B0B0',
  function: '#C8C8C8',
};

// --text-primary / --text-dark-primary in _colors.scss; palettes carry their own.
const LIGHT_TEXT = '#0F172A';
const DARK_TEXT = '#FFFFFF';

// Monaco's own bracket pair colours (on by default), kept under the same floor.
const LIGHT_BRACKETS = ['#0431FA', '#319331', '#7B3814'];
const DARK_BRACKETS = ['#FFD700', '#DA70D6', '#179FFF'];

const LIGHT_COLORS: monaco.editor.IColors = {
  'editor.background': '#f9f9f9',
  'editor.foreground': '#24292E',
  'editorLineNumber.foreground': '#C0C0C0',
  'editorLineNumber.activeForeground': '#8B8B8B',
  'editor.selectionBackground': '#E0E0E0',
  'editor.inactiveSelectionBackground': '#EBEBEB',
  'editorCursor.foreground': '#24292E',
  'editor.findMatchBackground': '#E8E8E8',
  'editor.findMatchHighlightBackground': '#F0F0F0',
  'editorSuggestWidget.background': '#FFFFFF',
  'editorSuggestWidget.foreground': '#333333',
  'editorSuggestWidget.selectedBackground': '#F0F0F0',
  'editorSuggestWidget.border': '#E5E5E5',
  'editorWidget.background': '#FFFFFF',
  'editorWidget.border': '#E5E5E5',
  'editor.lineHighlightBackground': '#00000005',
  'editorIndentGuide.background': '#00000000',
  'editorIndentGuide.activeBackground': '#00000000',
  'scrollbar.shadow': '#00000000',
  'editorOverviewRuler.border': '#00000000',
  // Monochrome go-to-definition affordances: ctrl+hover link + peek widget.
  'editorLink.activeForeground': '#24292E',
  'peekView.border': '#E5E5E5',
  'peekViewEditor.background': '#FFFFFF',
  'peekViewEditor.matchHighlightBackground': '#E8E8E8',
  'peekViewResult.background': '#FFFFFF',
  'peekViewResult.matchHighlightBackground': '#F0F0F0',
  'peekViewResult.selectionBackground': '#F0F0F0',
  'peekViewResult.selectionForeground': '#24292E',
  'peekViewResult.fileForeground': '#24292E',
  'peekViewResult.lineForeground': '#8B949E',
  'peekViewTitle.background': '#FFFFFF',
  'peekViewTitleLabel.foreground': '#24292E',
  'peekViewTitleDescription.foreground': '#8B949E',
  // The peek results tree is a generic Monaco list; kill the blue focus
  // outline and badge so selection stays monochrome.
  'list.focusOutline': '#00000000',
  'list.focusBackground': '#F0F0F0',
  'list.activeSelectionBackground': '#F0F0F0',
  'list.activeSelectionForeground': '#24292E',
  'list.inactiveSelectionBackground': '#F0F0F0',
  'list.hoverBackground': '#F5F5F5',
  'badge.background': '#E8E8E8',
  'badge.foreground': '#5A5A5A',
};

const DARK_COLORS: monaco.editor.IColors = {
  'editor.background': '#141414',
  'editor.foreground': '#B0B0B0',
  'editorLineNumber.foreground': '#3A3A3A',
  'editorLineNumber.activeForeground': '#606060',
  'editor.selectionBackground': '#2A2A2A',
  'editor.inactiveSelectionBackground': '#222222',
  'editorCursor.foreground': '#B0B0B0',
  'editor.findMatchBackground': '#2A2A2A',
  'editor.findMatchHighlightBackground': '#333333',
  'editorSuggestWidget.background': '#1A1A1A',
  'editorSuggestWidget.foreground': '#A0A0A0',
  'editorSuggestWidget.selectedBackground': '#252525',
  'editorSuggestWidget.border': '#2A2A2A',
  'editorWidget.background': '#1A1A1A',
  'editorWidget.border': '#2A2A2A',
  'editor.lineHighlightBackground': '#FFFFFF05',
  'editorIndentGuide.background': '#00000000',
  'editorIndentGuide.activeBackground': '#00000000',
  'scrollbar.shadow': '#00000000',
  'editorOverviewRuler.border': '#00000000',
  // Monochrome go-to-definition affordances: ctrl+hover link + peek widget.
  'editorLink.activeForeground': '#C8C8C8',
  'peekView.border': '#2A2A2A',
  'peekViewEditor.background': '#1A1A1A',
  'peekViewEditor.matchHighlightBackground': '#2A2A2A',
  'peekViewResult.background': '#1A1A1A',
  'peekViewResult.matchHighlightBackground': '#333333',
  'peekViewResult.selectionBackground': '#252525',
  'peekViewResult.selectionForeground': '#C8C8C8',
  'peekViewResult.fileForeground': '#B0B0B0',
  'peekViewResult.lineForeground': '#555555',
  'peekViewTitle.background': '#1A1A1A',
  'peekViewTitleLabel.foreground': '#B0B0B0',
  'peekViewTitleDescription.foreground': '#555555',
  // The peek results tree is a generic Monaco list; kill the blue focus
  // outline and badge so selection stays monochrome.
  'list.focusOutline': '#00000000',
  'list.focusBackground': '#252525',
  'list.activeSelectionBackground': '#252525',
  'list.activeSelectionForeground': '#C8C8C8',
  'list.inactiveSelectionBackground': '#252525',
  'list.hoverBackground': '#202020',
  'badge.background': '#2A2A2A',
  'badge.foreground': '#A0A0A0',
};

const LIN_SRGB_TO_XYZ_D50: Matrix = [
  [0.436065742824811, 0.385151321283676, 0.143078616732527],
  [0.222493598902982, 0.716887216908472, 0.060619184188546],
  [0.013923750238006, 0.097081022039155, 0.714185227722839],
];
const XYZ_D50_TO_LIN_SRGB: Matrix = [
  [3.134136070755664, -1.617386017629757, -0.490662232710054],
  [-0.978795575994328, 1.916254567259524, 0.03344287339036],
  [0.071965002624031, -0.228999559811329, 1.405386058710083],
];
const D50_WHITE: Rgb = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const LAB_E = 216 / 24389;
const LAB_K = 24389 / 27;

const parseHex = (hex: string): Rgb => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: Rgb): string =>
  `#${rgb
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) =>
  255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const multiply = (m: Matrix, v: Rgb): Rgb =>
  m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as Rgb;

const toLab = (rgb: Rgb): Rgb => {
  const f = multiply(LIN_SRGB_TO_XYZ_D50, rgb.map(toLinear) as Rgb).map((v, i) => {
    const r = v / D50_WHITE[i];
    return r > LAB_E ? Math.cbrt(r) : (LAB_K * r + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
};
const fromLabAxis = (f: number) => (f ** 3 > LAB_E ? f ** 3 : (116 * f - 16) / LAB_K);
const fromLab = ([l, a, b]: Rgb): Rgb => {
  const fy = (l + 16) / 116;
  const y = l > LAB_K * LAB_E ? fy ** 3 : l / LAB_K;
  const xyz: Rgb = [fromLabAxis(fy + a / 500), y, fromLabAxis(fy - b / 200)];
  return multiply(XYZ_D50_TO_LIN_SRGB, xyz.map((v, i) => v * D50_WHITE[i]) as Rgb).map(
    fromLinear,
  ) as Rgb;
};

// CSS `color-mix(in lab, base, tint amount)`.
export const mixLab = (base: string, tint: string, amount: number): string => {
  const x = toLab(parseHex(base));
  const y = toLab(parseHex(tint));
  return toHex(fromLab(x.map((v, i) => v + (y[i] - v) * amount) as Rgb));
};
export const over = (fg: string, alpha: number, bg: string): string => {
  const f = parseHex(fg);
  const b = parseHex(bg);
  return toHex(f.map((v, i) => v * alpha + b[i] * (1 - alpha)) as Rgb);
};
const luminance = (hex: string) => {
  const [r, g, b] = parseHex(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// CIE LCh colour at lightness l, giving up chroma (never hue) to stay inside sRGB.
const lchToHex = (l: number, chroma: number, hue: number): string => {
  for (let c = chroma; ; c = c > 0.5 ? c * 0.95 : 0) {
    const rgb = fromLab([l, c * Math.cos(hue), c * Math.sin(hue)]);
    if (c === 0 || rgb.every((v) => v > -0.5 && v < 255.5)) return toHex(rgb);
  }
};

// Keeps the colour's hue and chroma and moves its lightness the least distance toward
// `target` that reaches `floor` on every background; null when no lightness up to the
// target's does.
const floorColor = (
  color: string,
  backgrounds: string[],
  floor: number,
  target: string,
): string | null => {
  const passes = (c: string) => backgrounds.every((bg) => contrast(c, bg) >= floor);
  if (passes(color)) return color;
  const [l, a, b] = toLab(parseHex(color));
  const [lt] = toLab(parseHex(target));
  const steps = Math.ceil(Math.abs(lt - l) / LIGHTNESS_STEP);
  for (let i = 1; i <= steps; i++) {
    const candidate = lchToHex(l + ((lt - l) * i) / steps, Math.hypot(a, b), Math.atan2(b, a));
    if (passes(candidate)) return candidate;
  }
  return null;
};

// Code tokens to the code floor toward `text`; comments only to the comment floor, toward
// the floored code text so they never read louder than code.
export const floorSyntax = (
  syntax: Syntax,
  backgrounds: string[],
  text: string,
  fallback: { code: string; comment: string },
): Syntax => {
  const code = (color: string) => floorColor(color, backgrounds, CODE_FLOOR, text) ?? fallback.code;
  const plain = floorColor(syntax.plain, backgrounds, CODE_FLOOR, text);
  return {
    plain: plain ?? fallback.code,
    comment:
      floorColor(syntax.comment, backgrounds, COMMENT_FLOOR, plain ?? text) ?? fallback.comment,
    keyword: code(syntax.keyword),
    string: code(syntax.string),
    number: code(syntax.number),
    type: code(syntax.type),
    variable: code(syntax.variable),
    function: code(syntax.function),
  };
};

const editorTheme = (dark: boolean, colors: monaco.editor.IColors, text: string): EditorTheme => {
  const background = colors['editor.background'];
  const syntax = floorSyntax(dark ? DARK_SYNTAX : LIGHT_SYNTAX, [background], text, {
    code: text,
    comment: text,
  });
  const brackets = (dark ? DARK_BRACKETS : LIGHT_BRACKETS).map(
    (color) => floorColor(color, [background], CODE_FLOOR, text) ?? text,
  );
  return {
    syntax,
    text,
    data: {
      base: dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: SYNTAX_TOKENS.map((token) => ({
        token: token === 'plain' ? '' : token,
        foreground: syntax[token].slice(1),
        ...(token === 'plain' && { background }),
        ...(token === 'comment' && { fontStyle: 'italic' }),
      })),
      colors: {
        ...colors,
        ...Object.fromEntries(
          brackets.map((color, i) => [`editorBracketHighlight.foreground${i + 1}`, color]),
        ),
      },
    },
  };
};

// Reuse light/dark syntax; re-skin surfaces so canvas matches chrome (not white/black).
const skin = (palette: PaletteDef): EditorTheme => {
  const surface = palette.surfaceSecondary;
  const widget = palette.surface;
  const dark = palette.base === 'dark';
  return editorTheme(
    dark,
    {
      ...(dark ? DARK_COLORS : LIGHT_COLORS),
      'editor.background': surface,
      'editor.foreground': palette.textPrimary,
      'editorCursor.foreground': palette.textPrimary,
      'editorLineNumber.foreground': palette.textQuaternary,
      'editorLineNumber.activeForeground': palette.textTertiary,
      'editor.selectionBackground': palette.surfaceHover,
      'editor.inactiveSelectionBackground': palette.surfaceTertiary,
      'editor.findMatchBackground': palette.surfaceActive,
      'editor.findMatchHighlightBackground': palette.surfaceTertiary,
      'peekViewResult.lineForeground': palette.textTertiary,
      'peekViewTitleDescription.foreground': palette.textTertiary,
      'editorSuggestWidget.background': widget,
      'editorWidget.background': widget,
      'peekViewEditor.background': surface,
      'peekViewResult.background': widget,
      'peekViewTitle.background': widget,
      // Selection/hover/badge must track the palette too — the base theme's
      // grays read inverted against re-skinned surfaces.
      'peekViewResult.selectionBackground': palette.surfaceTertiary,
      'peekViewResult.selectionForeground': palette.textPrimary,
      'list.focusBackground': palette.surfaceTertiary,
      'list.activeSelectionBackground': palette.surfaceTertiary,
      'list.activeSelectionForeground': palette.textPrimary,
      'list.inactiveSelectionBackground': palette.surfaceTertiary,
      'list.hoverBackground': palette.surfaceTertiary,
      'badge.background': palette.surfaceTertiary,
      'badge.foreground': palette.textSecondary,
    },
    palette.textPrimary,
  );
};

export const THEME_DATA = {
  light: editorTheme(false, LIGHT_COLORS, LIGHT_TEXT),
  dark: editorTheme(true, DARK_COLORS, DARK_TEXT),
  ...(Object.fromEntries(
    Object.entries(PALETTES).map(([name, palette]) => [name, skin(palette)]),
  ) as Record<PaletteKey, EditorTheme>),
} satisfies Record<EditorThemeName, EditorTheme>;
