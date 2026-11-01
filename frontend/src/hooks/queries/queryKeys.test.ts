import { describe, it, expect } from 'vitest';
import { queryKeys } from './queryKeys';

// Load-bearing invalidation contract (see frontend/CLAUDE.md): every `xAll`
// prefix key must be a genuine prefix of the corresponding full key, so
// `invalidateQueries({ queryKey: xAll })` prefix-matches real entries.
const SB = 'sb1';

// [xAll name, prefixKey, fullKey]
const CONTRACT: ReadonlyArray<readonly [string, readonly unknown[], readonly unknown[]]> = [
  ['chatsSearchAll', queryKeys.chatsSearchAll, queryKeys.chatsSearch('q')],
  ['fileContentAll', queryKeys.sandbox.fileContentAll(SB), queryKeys.sandbox.fileContent(SB, '/f')],
  [
    'filesMetadataAll',
    queryKeys.sandbox.filesMetadataAll(SB),
    queryKeys.sandbox.filesMetadata(SB, '/cwd'),
  ],
  [
    'gitDiffAll',
    queryKeys.sandbox.gitDiffAll(SB),
    queryKeys.sandbox.gitDiff(SB, 'all', false, '/cwd'),
  ],
  [
    'gitFileBaselineAll',
    queryKeys.sandbox.gitFileBaselineAll(SB),
    queryKeys.sandbox.gitFileBaseline(SB, '/f', '/cwd'),
  ],
  [
    'gitChangedPathsAll',
    queryKeys.sandbox.gitChangedPathsAll(SB),
    queryKeys.sandbox.gitChangedPaths(SB, '/cwd'),
  ],
  [
    'gitBranchesAll',
    queryKeys.sandbox.gitBranchesAll(SB),
    queryKeys.sandbox.gitBranches(SB, '/cwd'),
  ],
  ['searchAll', queryKeys.sandbox.searchAll(SB), queryKeys.sandbox.search(SB, 'q', '/cwd')],
  ['pullsAll', queryKeys.github.pullsAll('o', 'r', 'c'), queryKeys.github.pulls('o', 'r', 'c')],
  ['cloudChatsAll', queryKeys.cloudChatsAll, queryKeys.cloudChats('https://c', 'me@x.com')],
  ['channelsAll', queryKeys.channelsAll, queryKeys.channels('ws1')],
  ['memoriesAll', queryKeys.memoriesAll, queryKeys.memories('ws1')],
];

function collectAllKeyNames(obj: Record<string, unknown>): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    if (key.endsWith('All')) return [key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return collectAllKeyNames(value as Record<string, unknown>);
    }
    return [];
  });
}

describe('queryKeys prefix-invalidation contract', () => {
  it.each(CONTRACT)('%s is a strict prefix of its full key', (_name, prefix, full) => {
    expect(full.length).toBeGreaterThan(prefix.length);
    expect(full.slice(0, prefix.length)).toEqual(prefix);
  });

  it('has a contract entry for every *All prefix key on queryKeys', () => {
    expect(CONTRACT.map(([name]) => name).sort()).toEqual(collectAllKeyNames(queryKeys).sort());
  });
});
