import { describe, it, expect } from 'vitest';
import { formatComposerSelections } from './composerSelections';
import type { ChatTextSelection, EditorCodeSelection } from '@/store/uiStore';

const editorSelection = (over: Partial<EditorCodeSelection> = {}): EditorCodeSelection => ({
  path: 'src/app.ts',
  startLine: 3,
  endLine: 5,
  languageId: 'typescript',
  text: 'const a = 1;',
  ...over,
});

const chatSelection = (text: string): ChatTextSelection => ({ kind: 'chat', text });

describe('formatComposerSelections', () => {
  it('returns the bare message when there are no selections', () => {
    expect(formatComposerSelections([], 'hello')).toBe('hello');
  });

  it('serializes an editor selection as a fenced block headed by path:range', () => {
    expect(formatComposerSelections([editorSelection()], 'why?')).toBe(
      'src/app.ts:3-5\n```typescript\nconst a = 1;\n```\n\nwhy?',
    );
  });

  it('collapses single-line ranges to one line number', () => {
    const result = formatComposerSelections([editorSelection({ startLine: 7, endLine: 7 })], 'q');
    expect(result.startsWith('src/app.ts:7\n')).toBe(true);
  });

  it('appends a diff-review comment under the code block', () => {
    const result = formatComposerSelections([editorSelection({ comment: 'looks wrong' })], '');
    expect(result).toBe('src/app.ts:3-5\n```typescript\nconst a = 1;\n```\nlooks wrong');
  });

  it('serializes a chat-text selection as a labeled fenced block without a language', () => {
    expect(formatComposerSelections([chatSelection('the deploy failed')], 'summarize')).toBe(
      'Selected from our conversation:\n```\nthe deploy failed\n```\n\nsummarize',
    );
  });

  it('lengthens the fence past backtick runs inside the selection', () => {
    const result = formatComposerSelections([chatSelection('use ```js\ncode\n``` here')], '');
    expect(result).toBe('Selected from our conversation:\n````\nuse ```js\ncode\n``` here\n````');
  });

  it('joins multiple selections of both kinds above the message', () => {
    const result = formatComposerSelections(
      [editorSelection(), chatSelection('quoted text')],
      'compare these',
    );
    expect(result).toBe(
      'src/app.ts:3-5\n```typescript\nconst a = 1;\n```\n\n' +
        'Selected from our conversation:\n```\nquoted text\n```\n\n' +
        'compare these',
    );
  });
});
