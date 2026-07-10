import { describe, it, expect } from 'vitest';
import { base64ToUint8Array } from './base64';

describe('base64ToUint8Array', () => {
  it('returns an empty array for an empty string', () => {
    const result = base64ToUint8Array('');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toHaveLength(0);
  });

  it('decodes ASCII bytes', () => {
    // btoa('hi') === 'aGk='
    expect(Array.from(base64ToUint8Array('aGk='))).toEqual([104, 105]);
  });

  it('decodes high bytes preserving values above 127', () => {
    // Bytes [0, 255] encode to 'AP8='.
    expect(Array.from(base64ToUint8Array('AP8='))).toEqual([0, 255]);
  });

  it('round-trips arbitrary bytes through btoa', () => {
    const bytes = [0, 1, 2, 127, 128, 200, 255];
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(Array.from(base64ToUint8Array(b64))).toEqual(bytes);
  });
});
