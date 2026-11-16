import { registerCustomCSSVariableTheme } from '@pierre/diffs';
import { DARK_THEME, LIGHT_THEME } from '@/hooks/useEditorTheme';
import { PALETTES } from '@/styles/palettes';

type Base = 'light' | 'dark';
type Rgb = [number, number, number];
type Matrix = [Rgb, Rgb, Rgb];

export const DIFF_SYNTAX_THEME = 'agentrove-syntax';

// Shiki's css-variables slots, each fed from the editor's Monaco token of the same role.
const SLOT_TOKENS: Record<string, string> = {
  foreground: '',
  'token-comment': 'comment',
  'token-keyword': 'keyword',
  'token-string': 'string',
  'token-string-expression': 'string',
  'token-constant': 'number',
  'token-function': 'function',
  'token-parameter': 'variable',
  'token-punctuation': '',
  'token-link': 'string',
  'token-inserted': '',
  'token-deleted': '',
};

const CODE_FLOOR = 4.5;
const COMMENT_FLOOR = 3;
const TEXT_PRIMARY = 'var(--theme-text-primary)';
const TEXT_SECONDARY = 'var(--theme-text-secondary)';

// pierre-light/-dark git colours (the library's defaults before this theme), which
// the add/remove line tints are mixed from.
const GIT_COLORS: Record<Base, { green: string; red: string; blue: string }> = {
  light: { green: '#18a46c', red: '#d52c36', blue: '#009fff' },
  dark: { green: '#07c480', red: '#ff2e3f', blue: '#009fff' },
};
// Line tint and word-emphasis alpha, as in @pierre/diffs' style.css.
const LINE_TINT: Record<Base, number> = { light: 0.12, dark: 0.2 };
const EMPHASIS_ALPHA: Record<Base, number> = { light: 0.15, dark: 0.2 };

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
const mixLab = (base: string, tint: string, amount: number): string => {
  const x = toLab(parseHex(base));
  const y = toLab(parseHex(tint));
  return toHex(fromLab(x.map((v, i) => v + (y[i] - v) * amount) as Rgb));
};
const over = (fg: string, alpha: number, bg: string): string => {
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

// Backgrounds a token can sit on: context, added and removed lines; and the
// word-level emphasis on added and removed lines.
const lineBackgrounds = (surface: string, base: Base) => {
  const { green, red } = GIT_COLORS[base];
  const added = mixLab(surface, green, LINE_TINT[base]);
  const removed = mixLab(surface, red, LINE_TINT[base]);
  return {
    line: [surface, added, removed],
    emphasis: [over(green, EMPHASIS_ALPHA[base], added), over(red, EMPHASIS_ALPHA[base], removed)],
  };
};

const EDITOR_RULES: Record<Base, typeof LIGHT_THEME.rules> = {
  light: LIGHT_THEME.rules,
  dark: DARK_THEME.rules,
};

const editorTokenColor = (base: Base, token: string): string =>
  `#${EDITOR_RULES[base].find((rule) => rule.token === token)?.foreground ?? EDITOR_RULES[base][0].foreground}`;

// Editor colour where it clears the floor on every given background, else the theme's
// own text token: secondary for comments on plain lines, primary otherwise (word-level
// highlights are the strongest tint, where secondary text can drop under 3:1).
const slotColor = (base: Base, token: string, backgrounds: string[], fallback: string) => {
  const color = editorTokenColor(base, token);
  const floor = token === 'comment' ? COMMENT_FLOOR : CODE_FLOOR;
  return backgrounds.every((bg) => contrast(color, bg) >= floor) ? color : fallback;
};

const themeDeclarations = (surface: string, base: Base): string => {
  const { line, emphasis } = lineBackgrounds(surface, base);
  const { green, red, blue } = GIT_COLORS[base];
  const slots = Object.entries(SLOT_TOKENS).map(
    ([slot, token]) =>
      `--diffs-${slot}: ${slotColor(base, token, line, token === 'comment' ? TEXT_SECONDARY : TEXT_PRIMARY)}; ` +
      `--diff-emphasis-${slot}: ${slotColor(base, token, emphasis, TEXT_PRIMARY)};`,
  );
  return [
    `--diffs-ansi-green: ${green};`,
    `--diffs-ansi-red: ${red};`,
    `--diffs-ansi-blue: ${blue};`,
    ...slots,
  ].join(' ');
};

const PLAIN_SURFACES: Record<Base, string> = {
  light: LIGHT_THEME.colors['editor.background'],
  dark: DARK_THEME.colors['editor.background'],
};

export const DIFF_SYNTAX_CSS = [
  ...(['light', 'dark'] as const).map(
    (base) => `:root[data-theme='${base}'] { ${themeDeclarations(PLAIN_SURFACES[base], base)} }`,
  ),
  ...Object.entries(PALETTES).map(
    ([name, def]) =>
      `:root[data-palette='${name}'] { ${themeDeclarations(def.surfaceSecondary, def.base)} }`,
  ),
].join('\n');

// Shadow-root rule: word-level change highlights sit on a stronger tint than their
// line, so their tokens (and untokenized plain text) switch to the emphasis-safe set.
export const DIFF_EMPHASIS_CSS = `[data-diff-span]{--diffs-light:var(--diff-emphasis-foreground);--diffs-dark:var(--diff-emphasis-foreground);${Object.keys(
  SLOT_TOKENS,
)
  .map((slot) => `--diffs-${slot}:var(--diff-emphasis-${slot})`)
  .join(';')}}`;

registerCustomCSSVariableTheme(DIFF_SYNTAX_THEME, {});
