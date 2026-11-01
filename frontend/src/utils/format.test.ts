import { describe, it, expect } from 'vitest';
import {
  formatResult,
  formatBytes,
  formatNumberCompact,
  stripMarkdownTitle,
  extractDomain,
} from './format';

describe('formatResult', () => {
  it('passes strings through, blanks nullish values and pretty-prints the rest', () => {
    expect(formatResult('hello')).toBe('hello');
    expect(formatResult(null)).toBe('');
    expect(formatResult(undefined)).toBe('');
    expect(formatResult({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
    [1.5 * 1024 * 1024, '1.5 MB'],
  ])('formats %i as %j', (bytes, label) => {
    expect(formatBytes(bytes)).toBe(label);
  });
});

describe('formatNumberCompact', () => {
  it.each([
    [999, '999'],
    [1000, '1K'],
    [1500, '2K'],
    [12_345, '12K'],
    [1_000_000, '1M'],
    [2_500_000, '2.5M'],
  ])('formats %i as %j', (num, label) => {
    expect(formatNumberCompact(num)).toBe(label);
  });
});

describe('stripMarkdownTitle', () => {
  it.each([
    ['**bold**', 'bold'],
    ['*italic*', 'italic'],
    ['__under__', 'under'],
    ['## Heading', 'Heading'],
    ['`code`', 'code'],
    ['~~gone~~', 'gone'],
    ['  spaced  ', 'spaced'],
    ['my_var', 'my_var'],
  ])('turns %j into %j', (title, expected) => {
    expect(stripMarkdownTitle(title)).toBe(expected);
  });
});

describe('extractDomain', () => {
  it('returns the hostname without a www. prefix', () => {
    expect(extractDomain('https://www.example.com/path')).toBe('example.com');
    expect(extractDomain('https://sub.example.com')).toBe('sub.example.com');
  });

  it('falls back to the raw string for invalid URLs, truncating long ones', () => {
    expect(extractDomain('not a url')).toBe('not a url');
    expect(extractDomain('x'.repeat(40))).toBe(`${'x'.repeat(27)}…`);
  });
});
