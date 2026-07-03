import type { FileDiffMetadata, SelectedLineRange, SelectionSide } from '@pierre/diffs';

// One rendered diff row in unified order; del/add are that side's line numbers.
interface DiffRow {
  prefix: ' ' | '+' | '-';
  del?: number;
  add?: number;
  text: string;
}

const TRAILING_NEWLINE = /\n$/;

function rowMatches(row: DiffRow, lineNumber: number, side: SelectionSide | undefined): boolean {
  if (side === 'deletions') return row.del === lineNumber;
  if (side === 'additions') return row.add === lineNumber;
  return row.del === lineNumber || row.add === lineNumber;
}

function buildUnifiedRows(file: FileDiffMetadata): DiffRow[] {
  const rows: DiffRow[] = [];
  // Context gaps between hunks are only addressable when the line arrays hold
  // complete file bodies (line number N ↔ index N-1). DiffView's
  // rebuildWithCollapsedContext (re-diff from full contents) guarantees this
  // for every rendered diff; partial patches can't expand gaps, so skipping
  // them is safe.
  const fullBodies = file.hunks.every(
    (h) =>
      h.additionLineIndex === h.additionStart - 1 && h.deletionLineIndex === h.deletionStart - 1,
  );

  let delNext = 1;
  let addNext = 1;
  for (const hunk of file.hunks) {
    if (fullBodies) {
      for (let i = 0; i < hunk.additionStart - addNext; i += 1) {
        rows.push({
          prefix: ' ',
          del: delNext + i,
          add: addNext + i,
          text: file.additionLines[addNext + i - 1] ?? '',
        });
      }
    }
    let delNo = hunk.deletionStart;
    let addNo = hunk.additionStart;
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        for (let i = 0; i < content.lines; i += 1) {
          rows.push({
            prefix: ' ',
            del: delNo + i,
            add: addNo + i,
            text: file.additionLines[content.additionLineIndex + i] ?? '',
          });
        }
        delNo += content.lines;
        addNo += content.lines;
      } else {
        for (let i = 0; i < content.deletions; i += 1) {
          rows.push({
            prefix: '-',
            del: delNo + i,
            text: file.deletionLines[content.deletionLineIndex + i] ?? '',
          });
        }
        for (let i = 0; i < content.additions; i += 1) {
          rows.push({
            prefix: '+',
            add: addNo + i,
            text: file.additionLines[content.additionLineIndex + i] ?? '',
          });
        }
        delNo += content.deletions;
        addNo += content.additions;
      }
    }
    delNext = delNo;
    addNext = addNo;
  }
  if (fullBodies) {
    for (let i = 0; addNext + i <= file.additionLines.length; i += 1) {
      rows.push({
        prefix: ' ',
        del: delNext + i,
        add: addNext + i,
        text: file.additionLines[addNext + i - 1] ?? '',
      });
    }
  }
  return rows;
}

// Selected lines of a diff as unified-diff text (`-`/`+`/space prefixes).
// Returns null when the range doesn't resolve against the file's hunks.
export function getSelectedDiffText(
  file: FileDiffMetadata,
  range: SelectedLineRange,
): string | null {
  const rows = buildUnifiedRows(file);
  const endSide = range.endSide ?? range.side;
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (startIdx === -1 && rowMatches(rows[i], range.start, range.side)) startIdx = i;
    if (rowMatches(rows[i], range.end, endSide)) endIdx = i;
  }
  if (startIdx === -1 || endIdx === -1) return null;
  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);
  return rows
    .slice(lo, hi + 1)
    .map((row) => `${row.prefix}${row.text.replace(TRAILING_NEWLINE, '')}`)
    .join('\n');
}
