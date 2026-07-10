import { describe, it, expect } from 'vitest';
import {
  buildDefinitionSearch,
  escapeSymbolForRegex,
  searchIncludeForLanguage,
} from './definitionPatterns';

describe('escapeSymbolForRegex', () => {
  it('leaves a plain identifier untouched', () => {
    expect(escapeSymbolForRegex('fooBar')).toBe('fooBar');
  });

  it('escapes regex metacharacters', () => {
    expect(escapeSymbolForRegex('a.b')).toBe('a\\.b');
    expect(escapeSymbolForRegex('$var')).toBe('\\$var');
    expect(escapeSymbolForRegex('a(b)[c]')).toBe('a\\(b\\)\\[c\\]');
  });
});

describe('buildDefinitionSearch', () => {
  it('substitutes the symbol into every pattern and drops the placeholder', () => {
    const { pattern } = buildDefinitionSearch('typescript', 'foo');
    expect(pattern).toContain('foo');
    expect(pattern).not.toContain('__SYMBOL__');
  });

  it('joins the language patterns with an alternation', () => {
    const { pattern } = buildDefinitionSearch('typescript', 'foo');
    // Two TS patterns are OR-ed together.
    expect(pattern.split('|').length).toBeGreaterThan(1);
  });

  it('returns the language file-family include', () => {
    expect(buildDefinitionSearch('typescript', 'foo').include).toBe(
      '*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
    );
    expect(buildDefinitionSearch('python', 'foo').include).toBe('*.py');
    expect(buildDefinitionSearch('go', 'foo').include).toBe('*.go');
    expect(buildDefinitionSearch('rust', 'foo').include).toBe('*.rs');
    expect(buildDefinitionSearch('ruby', 'foo').include).toBe('*.rb');
  });

  it('falls back to the default query (no include) for unknown languages', () => {
    const { pattern, include } = buildDefinitionSearch('cobol', 'foo');
    expect(include).toBeUndefined();
    expect(pattern).toContain('foo');
    expect(pattern).not.toContain('__SYMBOL__');
  });

  it('escapes regex specials in the symbol before substitution', () => {
    const { pattern } = buildDefinitionSearch('typescript', 'foo.bar');
    // The dot is escaped so it matches a literal `.`, not any char.
    expect(pattern).toContain('foo\\.bar');
    expect(pattern).not.toContain('foo.bar'); // no unescaped form leaks through
  });

  it('produces a regex that matches definitions but not call sites', () => {
    const { pattern } = buildDefinitionSearch('typescript', 'foo');
    const re = new RegExp(pattern);
    expect(re.test('function foo() {}')).toBe(true);
    expect(re.test('const foo = 1')).toBe(true);
    expect(re.test('interface foo {}')).toBe(true);
    expect(re.test('foo: (')).toBe(true);
    // A bare call site has no preceding definition keyword or `:`/`=`.
    expect(re.test('  foo()')).toBe(false);
  });

  it('escapes the symbol so specials do not act as wildcards in the compiled regex', () => {
    const { pattern } = buildDefinitionSearch('typescript', 'a.b');
    const re = new RegExp(pattern);
    expect(re.test('const a.b = 1')).toBe(true);
    // The `.` is literal, so `aXb` must not match.
    expect(re.test('const aXb = 1')).toBe(false);
  });
});

describe('searchIncludeForLanguage', () => {
  it('returns the include glob for a known language', () => {
    expect(searchIncludeForLanguage('python')).toBe('*.py');
  });

  it('returns undefined for an unknown language (default query has no include)', () => {
    expect(searchIncludeForLanguage('cobol')).toBeUndefined();
  });
});
