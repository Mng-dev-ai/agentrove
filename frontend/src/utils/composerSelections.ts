import type { ComposerSelection } from '@/store/uiStore';

const BACKTICK_RUN = /`+/g;

export function formatComposerSelections(selections: ComposerSelection[], message: string): string {
  // Chips are UI-only; at send, selections become fenced blocks above the message.
  const blocks = selections.map((s) => {
    // Fence longer than any run in the text so nested ``` can't close early.
    const longestRun =
      s.text.match(BACKTICK_RUN)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
    const fence = '`'.repeat(Math.max(3, longestRun + 1));
    if ('kind' in s) {
      return `Selected from our conversation:\n${fence}\n${s.text}\n${fence}`;
    }
    const lineRef = s.startLine === s.endLine ? `${s.startLine}` : `${s.startLine}-${s.endLine}`;
    const block = `${s.path}:${lineRef}\n${fence}${s.languageId}\n${s.text}\n${fence}`;
    return s.comment ? `${block}\n${s.comment}` : block;
  });
  return [...blocks, message].filter(Boolean).join('\n\n');
}
