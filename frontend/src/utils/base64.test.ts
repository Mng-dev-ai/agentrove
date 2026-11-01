import { describe, it, expect } from 'vitest';
import { base64ToUint8Array } from './base64';

describe('base64ToUint8Array', () => {
  it('decodes high bytes without sign or charset mangling', () => {
    expect(Array.from(base64ToUint8Array('AP8='))).toEqual([0, 255]);
  });
});
