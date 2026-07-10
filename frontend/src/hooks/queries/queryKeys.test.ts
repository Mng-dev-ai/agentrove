import { describe, it, expect } from 'vitest';
import { queryKeys } from './queryKeys';

// Load-bearing invalidation contract (see frontend/CLAUDE.md): every `xAll`
// prefix key must be a genuine prefix of the corresponding full key, so
// `invalidateQueries({ queryKey: xAll })` prefix-matches real entries. Prefix
// keys use concrete (defined) dimension values — invalidating with `undefined`
// would not prefix-match populated keys.
const SB = 'sb1';

// [label, prefixKey, fullKey] — the full key must extend the prefix.
const CONTRACT: ReadonlyArray<readonly [string, readonly unknown[], readonly unknown[]]> = [
  ['chatsSearch', queryKeys.chatsSearchAll, queryKeys.chatsSearch('q')],
  [
    'sandbox.fileContent',
    queryKeys.sandbox.fileContentAll(SB),
    queryKeys.sandbox.fileContent(SB, '/f'),
  ],
  [
    'sandbox.filesMetadata',
    queryKeys.sandbox.filesMetadataAll(SB),
    queryKeys.sandbox.filesMetadata(SB, '/cwd'),
  ],
  [
    'sandbox.gitDiff',
    queryKeys.sandbox.gitDiffAll(SB),
    queryKeys.sandbox.gitDiff(SB, 'all', false, '/cwd'),
  ],
  [
    'sandbox.gitFileBaseline',
    queryKeys.sandbox.gitFileBaselineAll(SB),
    queryKeys.sandbox.gitFileBaseline(SB, '/f', '/cwd'),
  ],
  [
    'sandbox.gitChangedPaths',
    queryKeys.sandbox.gitChangedPathsAll(SB),
    queryKeys.sandbox.gitChangedPaths(SB, '/cwd'),
  ],
  [
    'sandbox.gitBranches',
    queryKeys.sandbox.gitBranchesAll(SB),
    queryKeys.sandbox.gitBranches(SB, '/cwd'),
  ],
  ['sandbox.search', queryKeys.sandbox.searchAll(SB), queryKeys.sandbox.search(SB, 'q', '/cwd')],
  ['cloudChats', queryKeys.cloudChatsAll, queryKeys.cloudChats('https://c', 'me@x.com')],
];

describe('queryKeys prefix-invalidation contract', () => {
  it.each(CONTRACT)('%s full key extends its All prefix', (_label, prefix, full) => {
    expect(full.length).toBeGreaterThan(prefix.length);
    expect(full.slice(0, prefix.length)).toEqual(prefix);
  });

  it('covers every *All prefix key defined on queryKeys', () => {
    // Guard against a new xAll variant being added without a contract entry.
    const collectAllKeys = (obj: Record<string, unknown>): string[] =>
      Object.entries(obj).flatMap(([key, value]) => {
        if (key.endsWith('All')) return [key];
        // Recurse into nested groups (e.g. sandbox), skipping functions/arrays.
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return collectAllKeys(value as Record<string, unknown>);
        }
        return [];
      });

    const allKeyNames = collectAllKeys(queryKeys).sort();
    expect(allKeyNames).toEqual(
      [
        'chatsSearchAll',
        'cloudChatsAll',
        'fileContentAll',
        'filesMetadataAll',
        'gitBranchesAll',
        'gitChangedPathsAll',
        'gitDiffAll',
        'gitFileBaselineAll',
        'searchAll',
      ].sort(),
    );
    expect(CONTRACT).toHaveLength(allKeyNames.length);
  });
});
