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

describe('chatOrigin tracking', () => {
  beforeEach(() => {
    clearCloudOrigins();
    localStorage.clear();
    clearCloudOrigins(); // re-persist the cleared (empty) sets after wiping storage
  });

  it('marks and reports cloud chats independently from sandboxes', () => {
    markCloudChats(['c1', 'c2']);
    expect(isCloudChat('c1')).toBe(true);
    expect(isCloudChat('c2')).toBe(true);
    expect(isCloudChat('c3')).toBe(false);
    // Sandbox set is separate — a chat id is not a sandbox id.
    expect(isCloudSandbox('c1')).toBe(false);
  });

  it('marks and reports cloud sandboxes', () => {
    markCloudSandboxes(['s1']);
    expect(isCloudSandbox('s1')).toBe(true);
    expect(isCloudChat('s1')).toBe(false);
  });

  it('persists marked chat ids to localStorage', () => {
    markCloudChats(['x']);
    expect(JSON.parse(localStorage.getItem(CHATS_KEY) ?? '[]')).toEqual(['x']);
  });

  it('is idempotent for already-marked ids', () => {
    markCloudChats(['dup']);
    markCloudChats(['dup']);
    expect(JSON.parse(localStorage.getItem(CHATS_KEY) ?? '[]')).toEqual(['dup']);
  });

  it('clears both sets and their persisted storage', () => {
    markCloudChats(['c1']);
    markCloudSandboxes(['s1']);
    clearCloudOrigins();
    expect(isCloudChat('c1')).toBe(false);
    expect(isCloudSandbox('s1')).toBe(false);
    expect(JSON.parse(localStorage.getItem(CHATS_KEY) ?? '[]')).toEqual([]);
    expect(JSON.parse(localStorage.getItem(SANDBOXES_KEY) ?? '[]')).toEqual([]);
  });
});

describe('chatOrigin hydration from localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('hydrates only string ids, dropping non-strings', async () => {
    localStorage.setItem(CHATS_KEY, JSON.stringify(['a', 'b', 1, null]));
    const mod = await import('./chatOrigin');
    expect(mod.isCloudChat('a')).toBe(true);
    expect(mod.isCloudChat('b')).toBe(true);
    expect(mod.isCloudChat('1')).toBe(false);
  });

  it('ignores a non-array persisted value', async () => {
    localStorage.setItem(CHATS_KEY, JSON.stringify('not-an-array'));
    const mod = await import('./chatOrigin');
    expect(mod.isCloudChat('n')).toBe(false);
  });

  it('recovers from malformed JSON without throwing', async () => {
    localStorage.setItem(CHATS_KEY, '{not valid json');
    const mod = await import('./chatOrigin');
    expect(mod.isCloudChat('anything')).toBe(false);
  });
});
