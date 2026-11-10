import { describe, expect, it } from 'vitest';
import type { Chat } from '@/types/chat.types';
import { mergeRecentSources } from './mergeRecentSources';

function chat(id: string, minute: number): Chat {
  const timestamp = new Date(Date.UTC(2026, 6, 12, 12, minute)).toISOString();
  return {
    id,
    user_id: 'user',
    title: id,
    workspace_id: 'workspace',
    sandbox_id: 'sandbox',
    created_at: timestamp,
    updated_at: timestamp,
    pinned_at: null,
    worktree_cwd: null,
    parent_chat_id: null,
    channel_id: null,
    sub_thread_count: 0,
    session_agent_kind: null,
    unread: false,
    last_model_id: null,
    last_thinking_mode: null,
    last_persona_name: null,
  };
}

const ids = (chats: Chat[]) => chats.map((c) => c.id);

describe('mergeRecentSources', () => {
  it('merges every source newest-first when all are fully loaded', () => {
    const merged = mergeRecentSources(
      [
        { items: [chat('local-1', 50), chat('local-2', 10)], hasMore: false },
        { items: [chat('vps-1', 40)], hasMore: false },
        { items: [chat('ec2-1', 30), chat('ec2-2', 5)], hasMore: false },
      ],
      (c) => c.updated_at,
    );
    expect(ids(merged)).toEqual(['local-1', 'vps-1', 'ec2-1', 'local-2', 'ec2-2']);
  });

  it('holds back rows older than the newest floor among sources with more pages', () => {
    const merged = mergeRecentSources(
      [
        { items: [chat('local-1', 50), chat('local-2', 10)], hasMore: false },
        { items: [chat('vps-1', 45), chat('vps-2', 35)], hasMore: true },
        { items: [chat('ec2-1', 40), chat('ec2-2', 20)], hasMore: true },
      ],
      (c) => c.updated_at,
    );
    expect(ids(merged)).toEqual(['local-1', 'vps-1', 'ec2-1', 'vps-2']);
  });

  it('ignores the floor of an exhausted or empty source', () => {
    const merged = mergeRecentSources(
      [
        { items: [chat('local-1', 50), chat('local-2', 10)], hasMore: true },
        { items: [], hasMore: true },
        { items: [chat('ec2-1', 5)], hasMore: false },
      ],
      (c) => c.updated_at,
    );
    expect(ids(merged)).toEqual(['local-1', 'local-2']);
  });
});
