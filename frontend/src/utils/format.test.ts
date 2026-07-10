import { describe, it, expect } from 'vitest';
import {
  formatResult,
  formatValue,
  extractFilename,
  formatBytes,
  formatNumberCompact,
  stripMarkdownTitle,
  extractDomain,
} from './format';

describe('formatResult', () => {
  it('returns strings unchanged', () => {
    expect(formatResult('hello')).toBe('hello');
  });

  it('returns an empty string for null and undefined', () => {
    expect(formatResult(null)).toBe('');
    expect(formatResult(undefined)).toBe('');
  });

  it('pretty-prints non-string values with 2-space indent', () => {
    expect(formatResult({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('formatValue', () => {
  it('returns strings unchanged', () => {
    expect(formatValue('x')).toBe('x');
  });

  it('JSON-stringifies non-strings compactly', () => {
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue(42)).toBe('42');
  });
});

describe('extractFilename', () => {
  it('returns the last path segment', () => {
    expect(extractFilename('/a/b/c.txt')).toBe('c.txt');
  });

  it('returns the input when there is no slash', () => {
    expect(extractFilename('file.txt')).toBe('file.txt');
  });

  // `?? path` only guards against pop() returning undefined; an empty last
  // segment (trailing slash) is a string, so it is returned as-is.
  it('returns an empty string for a trailing slash', () => {
    expect(extractFilename('a/b/')).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats bytes under 1KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

describe('formatNumberCompact', () => {
  it('returns the plain number under 1000', () => {
    expect(formatNumberCompact(0)).toBe('0');
    expect(formatNumberCompact(999)).toBe('999');
  });

  it('formats thousands with a rounded K', () => {
    expect(formatNumberCompact(1000)).toBe('1K');
    expect(formatNumberCompact(1500)).toBe('2K');
    expect(formatNumberCompact(12345)).toBe('12K');
  });

  it('formats millions with one decimal, trimming .0', () => {
    expect(formatNumberCompact(1_000_000)).toBe('1M');
    expect(formatNumberCompact(2_500_000)).toBe('2.5M');
  });

  // Suspicious-but-harmless: 999_500..999_999 round up to 1000 while still < 1M,
  // so they render "1000K" rather than "1M". Documenting current behavior.
  it('renders "1000K" just below one million (known edge)', () => {
    expect(formatNumberCompact(999_999)).toBe('1000K');
  });
});

describe('stripMarkdownTitle', () => {
  it('strips bold and italic pairs', () => {
    expect(stripMarkdownTitle('**bold**')).toBe('bold');
    expect(stripMarkdownTitle('*italic*')).toBe('italic');
    expect(stripMarkdownTitle('__under__')).toBe('under');
  });

  it('leaves an isolated underscore intact', () => {
    expect(stripMarkdownTitle('my_var')).toBe('my_var');
  });

  it('strips a leading heading marker', () => {
    expect(stripMarkdownTitle('## Heading')).toBe('Heading');
  });

  it('strips inline code and strikethrough', () => {
    expect(stripMarkdownTitle('`code`')).toBe('code');
    expect(stripMarkdownTitle('~~gone~~')).toBe('gone');
  });

  it('trims surrounding whitespace', () => {
    expect(stripMarkdownTitle('  spaced  ')).toBe('spaced');
  });
});

describe('extractDomain', () => {
  it('returns the hostname without a www. prefix', () => {
    expect(extractDomain('https://www.example.com/path')).toBe('example.com');
    expect(extractDomain('https://sub.example.com')).toBe('sub.example.com');
  });

  it('falls back to the raw string for invalid URLs', () => {
    expect(extractDomain('not a url')).toBe('not a url');
  });

  it('truncates a long invalid string with an ellipsis', () => {
    const long = 'x'.repeat(40);
    const result = extractDomain(long);
    expect(result).toBe(`${'x'.repeat(27)}…`);
    expect(result).toHaveLength(28);
  });
});
