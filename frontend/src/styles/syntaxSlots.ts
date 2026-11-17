import type { SyntaxToken } from './editorThemes';

// Shiki's css-variables slots, each fed from the editor's Monaco token of the same role.
export const SYNTAX_SLOT_TOKENS: Record<string, SyntaxToken> = {
  foreground: 'plain',
  'token-comment': 'comment',
  'token-keyword': 'keyword',
  'token-string': 'string',
  'token-string-expression': 'string',
  'token-constant': 'number',
  'token-function': 'function',
  'token-parameter': 'variable',
  'token-punctuation': 'plain',
  'token-link': 'string',
  'token-inserted': 'plain',
  'token-deleted': 'plain',
};
