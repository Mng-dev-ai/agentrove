import { describe, expect, it } from 'vitest';
import type { ThemedToken } from '@pierre/diffs';
import { createCodeHighlight } from './codeHighlight';

const text = (lines: ThemedToken[][]) =>
  lines.map((line) => line.map((token) => token.content).join('')).join('\n');

async function highlightTs() {
  const highlight = await createCodeHighlight('ts');
  if (!highlight) throw new Error('typescript grammar did not load');
  return highlight;
}

describe('createCodeHighlight', () => {
  it('rewinds to the last shared line when streamed code is taken back', async () => {
    const streamed = await highlightTs();
    const before = streamed.feed('const a = 1;\nlet b = "x";\n``', Infinity);
    const after = streamed.feed('const a = 1;\nlet b = "x";', Infinity);

    expect(after.lines[0]).toBe(before.lines[0]);
    expect(text(after.lines)).toBe('const a = 1;\nlet b = "x";');
    expect(after.lines).toEqual(
      (await highlightTs()).feed('const a = 1;\nlet b = "x";', Infinity).lines,
    );
  });

  it('returns null for a language Shiki does not know', async () => {
    expect(await createCodeHighlight('foobarlang')).toBeNull();
  });
});
