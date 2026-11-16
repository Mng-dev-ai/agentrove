import { registerCustomCSSVariableTheme } from '@pierre/diffs';
import type { EditorTheme, SyntaxToken } from '@/styles/editorThemes';
import {
  CODE_FLOOR,
  COMMENT_FLOOR,
  THEME_DATA,
  contrast,
  mixLab,
  over,
} from '@/styles/editorThemes';

type Base = 'light' | 'dark';

export const DIFF_SYNTAX_THEME = 'agentrove-syntax';

// Shiki's css-variables slots, each fed from the editor's Monaco token of the same role.
const SLOT_TOKENS: Record<string, SyntaxToken> = {
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

// Editor colour where it clears the floor on every given background, else the theme's
// own text token: secondary for comments on plain lines, primary otherwise (word-level
// highlights are the strongest tint, where secondary text can drop under 3:1).
const slotColor = (color: string, comment: boolean, backgrounds: string[], fallback: string) => {
  const floor = comment ? COMMENT_FLOOR : CODE_FLOOR;
  return backgrounds.every((bg) => contrast(color, bg) >= floor) ? color : fallback;
};

const themeDeclarations = ({ data, syntax }: EditorTheme): string => {
  const base: Base = data.base === 'vs-dark' ? 'dark' : 'light';
  const { line, emphasis } = lineBackgrounds(data.colors['editor.background'], base);
  const { green, red, blue } = GIT_COLORS[base];
  const slots = Object.entries(SLOT_TOKENS).map(([slot, token]) => {
    const comment = token === 'comment';
    return (
      `--diffs-${slot}: ${slotColor(syntax[token], comment, line, comment ? TEXT_SECONDARY : TEXT_PRIMARY)}; ` +
      `--diff-emphasis-${slot}: ${slotColor(syntax[token], comment, emphasis, TEXT_PRIMARY)};`
    );
  });
  return [
    `--diffs-ansi-green: ${green};`,
    `--diffs-ansi-red: ${red};`,
    `--diffs-ansi-blue: ${blue};`,
    ...slots,
  ].join(' ');
};

export const DIFF_SYNTAX_CSS = Object.entries(THEME_DATA)
  .map(([name, theme]) => {
    const selector = name === 'light' || name === 'dark' ? 'data-theme' : 'data-palette';
    return `:root[${selector}='${name}'] { ${themeDeclarations(theme)} }`;
  })
  .join('\n');

// Shadow-root rule: word-level change highlights sit on a stronger tint than their
// line, so their tokens (and untokenized plain text) switch to the emphasis-safe set.
export const DIFF_EMPHASIS_CSS = `[data-diff-span]{--diffs-light:var(--diff-emphasis-foreground);--diffs-dark:var(--diff-emphasis-foreground);${Object.keys(
  SLOT_TOKENS,
)
  .map((slot) => `--diffs-${slot}:var(--diff-emphasis-${slot})`)
  .join(';')}}`;

registerCustomCSSVariableTheme(DIFF_SYNTAX_THEME, {});
