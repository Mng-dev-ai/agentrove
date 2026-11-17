import { getHighlighterIfLoaded, getSharedHighlighter } from '@pierre/diffs';
import type { DiffsHighlighter, DiffsStreamTokenizer, ThemedToken } from '@pierre/diffs';
import { SYNTAX_THEME } from '@/styles/syntaxTheme';

const MAX_LINE_LENGTH = 1000;
const RELEASED_LIMIT = 8;

interface Highlighted {
  source: string;
  lines: ThemedToken[][];
}

const EMPTY: Highlighted = { source: '', lines: [[]] };

export class CodeHighlight {
  private tokenizer: DiffsStreamTokenizer;
  private highlighted = EMPTY;
  private checkpoints: { end: number; tokenizer: DiffsStreamTokenizer }[] = [];

  constructor(
    readonly language: string,
    tokenizer: DiffsStreamTokenizer,
  ) {
    this.tokenizer = tokenizer;
  }

  get source() {
    return this.highlighted.source;
  }

  feed(code: string, deadline: number): Highlighted {
    if (!code.startsWith(this.highlighted.source)) this.rewind(code);
    let { source } = this.highlighted;
    if (source.length === code.length) return this.highlighted;
    const lines = this.highlighted.lines.slice(0, -1);
    let tail = this.highlighted.lines[lines.length];
    do {
      const end = code.indexOf('\n', source.length);
      const chunk = code.slice(source.length, end === -1 ? code.length : end + 1);
      const result = this.tokenizer.enqueue(chunk);
      if (result instanceof Promise)
        throw new Error('Code highlighting needs a synchronous tokenizer');
      const { stable, unstable } = result;
      let line: ThemedToken[] = [];
      for (const token of stable) {
        if (token.content === '\n') {
          lines.push(line);
          line = [];
        } else {
          line.push(token);
        }
      }
      tail = unstable;
      source += chunk;
      if (end !== -1)
        this.checkpoints.push({ end: source.length, tokenizer: this.tokenizer.clone() });
    } while (source.length < code.length && performance.now() < deadline);
    this.highlighted = { source, lines: [...lines, tail] };
    return this.highlighted;
  }

  private rewind(code: string) {
    const { source, lines } = this.highlighted;
    let common = 0;
    while (common < code.length && code[common] === source[common]) common++;
    let kept = this.checkpoints.length;
    while (kept > 0 && this.checkpoints[kept - 1].end > common) kept--;
    this.checkpoints.length = kept;
    const checkpoint = this.checkpoints[kept - 1];
    if (checkpoint) {
      this.tokenizer.dispose();
      this.tokenizer = checkpoint.tokenizer.clone();
    } else {
      this.tokenizer.clear();
    }
    this.highlighted = {
      source: source.slice(0, checkpoint?.end ?? 0),
      lines: [...lines.slice(0, kept), []],
    };
  }

  dispose() {
    this.tokenizer.dispose();
  }
}

const highlightWith = (highlighter: DiffsHighlighter, language: string) =>
  new CodeHighlight(
    language,
    highlighter.createStreamTokenizer({
      lang: language.toLowerCase(),
      theme: SYNTAX_THEME,
      tokenizeMaxLineLength: MAX_LINE_LENGTH,
    }),
  );

export function loadedCodeHighlight(language: string): CodeHighlight | null {
  const highlighter = getHighlighterIfLoaded({
    theme: SYNTAX_THEME,
    lang: language.toLowerCase(),
  });
  return highlighter ? highlightWith(highlighter, language) : null;
}

export async function createCodeHighlight(language: string): Promise<CodeHighlight | null> {
  try {
    const highlighter = await getSharedHighlighter({
      themes: [SYNTAX_THEME],
      langs: [language.toLowerCase()],
    });
    return highlightWith(highlighter, language);
  } catch {
    return null;
  }
}

const released: CodeHighlight[] = [];

export const firstLine = (text: string) => text.slice(0, text.indexOf('\n') + 1);

export function takeReleased(language: string, head: string): CodeHighlight | null {
  if (head === '') return null;
  const index = released.findIndex(
    (highlight) => highlight.language === language && firstLine(highlight.source) === head,
  );
  return index === -1 ? null : released.splice(index, 1)[0];
}

export function release(highlight: CodeHighlight) {
  released.push(highlight);
  if (released.length > RELEASED_LIMIT) released.shift()?.dispose();
}
