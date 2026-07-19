// Go-to-definition regexes: definition sites only. Ripgrep has no lookarounds — use \b.
const SYMBOL = '__SYMBOL__';
// /g replace (not replaceAll) — target lib < es2021; keeps $ replacement semantics.
const SYMBOL_RE = /__SYMBOL__/g;

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

interface LanguageQuery {
  patterns: string[];
  // Language file globs so keywords in other languages don't produce junk hits.
  include?: string;
}

const JS_QUERY: LanguageQuery = {
  patterns: [
    `\\b(?:function\\s*\\*?|class|interface|type|enum|namespace|const|let|var)\\s+${SYMBOL}\\b`,
    // Object/interface members and arrow-function properties: `foo: (` / `foo = async (`
    `\\b${SYMBOL}\\s*[:=]\\s*(?:async\\s*)?(?:function\\b|\\()`,
  ],
  include: '*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
};

const LANGUAGE_QUERIES: Record<string, LanguageQuery> = {
  typescript: JS_QUERY,
  javascript: JS_QUERY,
  python: {
    // `^SYMBOL [:=]` catches module-level constants without drowning in locals.
    patterns: [`\\b(?:def|class)\\s+${SYMBOL}\\b`, `^${SYMBOL}\\s*[:=]`],
    include: '*.py',
  },
  go: {
    patterns: [
      // `[` needs escaping — ripgrep's Rust regex nests character classes.
      `\\bfunc\\s+(?:\\([^)]*\\)\\s*)?${SYMBOL}\\s*[(\\[]`,
      `\\b(?:type|var|const)\\s+${SYMBOL}\\b`,
    ],
    include: '*.go',
  },
  rust: {
    patterns: [
      `\\b(?:fn|struct|enum|trait|mod|union|type|const|static)\\s+${SYMBOL}\\b`,
      `\\blet\\s+(?:mut\\s+)?${SYMBOL}\\b`,
    ],
    include: '*.rs',
  },
  ruby: {
    patterns: [`\\b(?:def|class|module)\\s+(?:self\\.)?${SYMBOL}\\b`],
    include: '*.rb',
  },
};

const DEFAULT_QUERY: LanguageQuery = {
  patterns: [
    `\\b(?:function|def|fn|func|class|struct|interface|trait|enum|type|module|namespace|const|let|var|val)\\s+${SYMBOL}\\b`,
  ],
};

export interface DefinitionSearch {
  pattern: string;
  include?: string;
}

export function escapeSymbolForRegex(symbol: string): string {
  return symbol.replace(REGEX_SPECIALS, '\\$&');
}

export function buildDefinitionSearch(languageId: string, symbol: string): DefinitionSearch {
  const query = LANGUAGE_QUERIES[languageId] ?? DEFAULT_QUERY;
  const escaped = escapeSymbolForRegex(symbol);
  return {
    pattern: query.patterns.map((p) => p.replace(SYMBOL_RE, escaped)).join('|'),
    include: query.include,
  };
}

export function searchIncludeForLanguage(languageId: string): string | undefined {
  return (LANGUAGE_QUERIES[languageId] ?? DEFAULT_QUERY).include;
}
