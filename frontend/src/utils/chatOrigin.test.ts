// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  markCloudChats,
  isCloudChat,
  markCloudSandboxes,
  isCloudSandbox,
  clearCloudOrigins,
} from './chatOrigin';

const CHATS_KEY = 'cloud-chat-ids';
const SANDBOXES_KEY = 'cloud-sandbox-ids';

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;

describe('chatOrigin tracking', () => {
  beforeEach(() => {
    clearCloudOrigins();
  });

  it('tracks cloud chats and sandboxes as separate sets', () => {
    markCloudChats(['c1', 'c2']);
    markCloudSandboxes(['s1']);

    expect(isCloudChat('c1')).toBe(true);
    expect(isCloudChat('c2')).toBe(true);
    expect(isCloudChat('c3')).toBe(false);
    expect(isCloudSandbox('s1')).toBe(true);
    expect(isCloudSandbox('c1')).toBe(false);
    expect(isCloudChat('s1')).toBe(false);
  });

  it('persists marked ids to localStorage', () => {
    markCloudChats(['x']);
    markCloudSandboxes(['s']);
    expect(stored(CHATS_KEY)).toEqual(['x']);
    expect(stored(SANDBOXES_KEY)).toEqual(['s']);
  });

  it('clears both sets and their persisted storage', () => {
    markCloudChats(['c1']);
    markCloudSandboxes(['s1']);
    clearCloudOrigins();
    expect(isCloudChat('c1')).toBe(false);
    expect(isCloudSandbox('s1')).toBe(false);
    expect(stored(CHATS_KEY)).toEqual([]);
    expect(stored(SANDBOXES_KEY)).toEqual([]);
  });
});

describe('chatOrigin hydration from localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('hydrates persisted string ids, dropping non-strings', async () => {
    localStorage.setItem(CHATS_KEY, JSON.stringify(['a', 'b', 1, null]));
    localStorage.setItem(SANDBOXES_KEY, JSON.stringify(['s']));
    const mod = await import('./chatOrigin');
    expect(mod.isCloudChat('a')).toBe(true);
    expect(mod.isCloudChat('b')).toBe(true);
    expect(mod.isCloudChat('1')).toBe(false);
    expect(mod.isCloudSandbox('s')).toBe(true);
  });

  it.each([
    ['a non-array value', JSON.stringify('not-an-array')],
    ['malformed JSON', '{not valid json'],
  ])('starts empty when storage holds %s', async (_label, raw) => {
    localStorage.setItem(CHATS_KEY, raw);
    const mod = await import('./chatOrigin');
    mod.markCloudChats(['fresh']);
    expect(stored(CHATS_KEY)).toEqual(['fresh']);
  });
});
