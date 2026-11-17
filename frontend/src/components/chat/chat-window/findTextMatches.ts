export interface TextMatch {
  startNode: number;
  startOffset: number;
  endNode: number;
  endOffset: number;
}

// Matches of `needle` in the concatenation of `texts`, as node index + offset pairs, so a
// match can span adjacent text nodes. `needle` must be non-empty.
export function findTextMatches(texts: readonly string[], needle: string): TextMatch[] {
  const matches: TextMatch[] = [];
  const joined = texts.join('');
  let startNode = 0;
  let startNodeAt = 0;
  for (
    let index = joined.indexOf(needle);
    index !== -1;
    index = joined.indexOf(needle, index + needle.length)
  ) {
    while (startNodeAt + texts[startNode].length <= index) startNodeAt += texts[startNode++].length;
    const end = index + needle.length;
    let endNode = startNode;
    let endNodeAt = startNodeAt;
    while (endNodeAt + texts[endNode].length < end) endNodeAt += texts[endNode++].length;
    matches.push({
      startNode,
      startOffset: index - startNodeAt,
      endNode,
      endOffset: end - endNodeAt,
    });
  }
  return matches;
}
