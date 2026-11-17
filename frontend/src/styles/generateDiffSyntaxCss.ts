import type { EditorTheme } from './editorThemes';
import { THEME_DATA, floorSyntax, mixLab, over } from './editorThemes';
import { SYNTAX_SLOT_TOKENS } from './syntaxSlots';

type Base = 'light' | 'dark';

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

// The editor's colours (already floored on its background) floored again on the diff's
// line tints. Word-level highlights are the strongest tint, where secondary text can drop
// under 3:1, so comments fall back to primary text there.
const themeDeclarations = ({ data, syntax, text }: EditorTheme): string => {
  const base: Base = data.base === 'vs-dark' ? 'dark' : 'light';
  const { line, emphasis } = lineBackgrounds(data.colors['editor.background'], base);
  const lineSyntax = floorSyntax(syntax, line, text, {
    code: TEXT_PRIMARY,
    comment: TEXT_SECONDARY,
  });
  const emphasisSyntax = floorSyntax(syntax, emphasis, text, {
    code: TEXT_PRIMARY,
    comment: TEXT_PRIMARY,
  });
  const { green, red, blue } = GIT_COLORS[base];
  const slots = Object.entries(SYNTAX_SLOT_TOKENS).map(
    ([slot, token]) =>
      `--diffs-${slot}: ${lineSyntax[token]}; --diff-emphasis-${slot}: ${emphasisSyntax[token]};`,
  );
  return [
    `--diffs-ansi-green: ${green};`,
    `--diffs-ansi-red: ${red};`,
    `--diffs-ansi-blue: ${blue};`,
    ...slots,
  ].join(' ');
};

export function generateDiffSyntaxCss(): string {
  return Object.entries(THEME_DATA)
    .map(([name, theme]) => {
      const selector = name === 'light' || name === 'dark' ? 'data-theme' : 'data-palette';
      return `:root[${selector}='${name}'] { ${themeDeclarations(theme)} }`;
    })
    .join('\n');
}
