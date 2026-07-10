// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { filterOptions, addResolvedPermission, isPermissionResolved } from './permissionStorage';
import type { PermissionOption } from '@/types/chat.types';

const STORAGE_KEY = 'agentrove_resolved_permission_seqs';

const opt = (kind: PermissionOption['kind']): PermissionOption => ({
  kind,
  name: kind,
  option_id: kind,
});

beforeEach(() => {
  localStorage.clear();
});

describe('filterOptions', () => {
  const options = [
    opt('allow_once'),
    opt('allow_always'),
    opt('reject_once'),
    opt('reject_always'),
  ];

  it('keeps only allow-prefixed options', () => {
    expect(filterOptions(options, 'allow').map((o) => o.kind)).toEqual([
      'allow_once',
      'allow_always',
    ]);
  });

  it('keeps only reject-prefixed options', () => {
    expect(filterOptions(options, 'reject').map((o) => o.kind)).toEqual([
      'reject_once',
      'reject_always',
    ]);
  });

  it('returns an empty array when there are no options', () => {
    expect(filterOptions([], 'allow')).toEqual([]);
  });
});

describe('addResolvedPermission / isPermissionResolved', () => {
  it('marks a seq resolved and scopes by chat id and seq', () => {
    addResolvedPermission('chat-a', 5);
    expect(isPermissionResolved('chat-a', 5)).toBe(true);
    expect(isPermissionResolved('chat-a', 6)).toBe(false);
    expect(isPermissionResolved('chat-b', 5)).toBe(false);
  });

  it('does not store duplicate keys', () => {
    addResolvedPermission('chat-a', 5);
    addResolvedPermission('chat-a', 5);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as string[];
    expect(stored).toEqual(['chat-a:5']);
  });

  it('recovers from malformed stored JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{');
    expect(isPermissionResolved('chat-a', 1)).toBe(false);
    addResolvedPermission('chat-a', 1);
    expect(isPermissionResolved('chat-a', 1)).toBe(true);
  });

  it('caps stored entries, dropping the oldest', () => {
    for (let seq = 0; seq < 205; seq++) addResolvedPermission('c', seq);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as string[];
    expect(stored).toHaveLength(200);
    // 205 pushes, capped at 200 -> the first 5 (seq 0..4) are evicted.
    expect(isPermissionResolved('c', 4)).toBe(false);
    expect(isPermissionResolved('c', 5)).toBe(true);
    expect(isPermissionResolved('c', 204)).toBe(true);
  });
});
