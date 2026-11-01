import { describe, it, expect } from 'vitest';
import {
  buildDefinitionSearch,
  escapeSymbolForRegex,
  searchIncludeForLanguage,
} from './definitionPatterns';

describe('escapeSymbolForRegex', () => {
  it('escapes regex metacharacters and leaves identifiers alone', () => {
    expect(escapeSymbolForRegex('fooBar')).toBe('fooBar');
    expect(escapeSymbolForRegex('$a.b(c)[d]')).toBe('\\$a\\.b\\(c\\)\\[d\\]');
  });
});

describe('buildDefinitionSearch', () => {
  it.each([
    [
      'typescript',
      [
        'function foo() {}',
        'export class foo {',
        'const foo = 1',
        '  foo: (a) => a,',
        'foo = async () => {}',
      ],
      ['  foo()', 'bar(foo)', 'const foobar = 1'],
    ],
    ['python', ['def foo(x):', 'class foo:', 'foo = 1'], ['    foo = 1', 'foo(1)']],
    [
      'go',
      ['func foo(a int) {', 'func (s *S) foo() {', 'func foo[T any](x T) {', 'type foo struct {'],
      ['foo()', 'x := foo'],
    ],
    ['rust', ['fn foo() {', 'pub struct foo {', 'let mut foo = 1;'], ['foo();']],
    ['ruby', ['def self.foo', 'module foo'], ['foo(1)']],
    ['cobol', ['val foo = 1', 'func foo()'], ['foo()']],
  ])('%s pattern matches definition sites but not usages', (language, defs, usages) => {
    const re = new RegExp(buildDefinitionSearch(language, 'foo').pattern);
    for (const line of defs) expect(re.test(line), line).toBe(true);
    for (const line of usages) expect(re.test(line), line).toBe(false);
  });

  it('treats regex specials in the symbol literally', () => {
    const re = new RegExp(buildDefinitionSearch('typescript', 'a.b').pattern);
    expect(re.test('const a.b = 1')).toBe(true);
    expect(re.test('const aXb = 1')).toBe(false);
  });

  it('scopes known languages to their files and leaves unknown languages unscoped', () => {
    expect(buildDefinitionSearch('python', 'foo').include).toBe('*.py');
    expect(buildDefinitionSearch('cobol', 'foo').include).toBeUndefined();
    expect(searchIncludeForLanguage('python')).toBe('*.py');
    expect(searchIncludeForLanguage('cobol')).toBeUndefined();
  });
});
