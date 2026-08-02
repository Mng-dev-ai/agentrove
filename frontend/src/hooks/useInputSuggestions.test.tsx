// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import { useInputSuggestions } from './useInputSuggestions';
import type { AgentKind, Chat } from '@/types/chat.types';
import type { FileStructure } from '@/types/file-system.types';
import type { SlashCommand } from '@/types/ui.types';

const CURRENT_CHAT_ID = 'chat-current';

function makeChat(id: string, title: string): Chat {
  return {
    id,
    user_id: 'u1',
    title,
    workspace_id: 'w1',
    sandbox_id: 's1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    pinned_at: null,
    worktree_cwd: null,
    parent_chat_id: null,
    sub_thread_count: 0,
    session_agent_kind: null,
    unread: false,
    last_model_id: null,
    last_thinking_mode: null,
    last_persona_name: null,
  };
}

const CHATS: Chat[] = [
  makeChat('chat-1', 'Bugfix for the parser'),
  makeChat('chat-2', 'Deploy runbook'),
  makeChat(CURRENT_CHAT_ID, 'Bugfix current thread'),
];

const FILES: FileStructure[] = [
  { path: 'src/bugreport.ts', content: '', type: 'file' },
  { path: 'src/unrelated.ts', content: '', type: 'file' },
];

function renderSuggestions(message: string) {
  const setMessage = vi.fn();
  const messageRef = { current: message };
  const { result } = renderHook(() =>
    useInputSuggestions({
      message,
      cursorPosition: message.length,
      setMessage,
      setCursorPosition: vi.fn(),
      messageRef,
      textareaRef: { current: null },
      fileStructure: FILES,
      mentionChats: CHATS,
      chatId: CURRENT_CHAT_ID,
      customSkills: [],
      builtinSlashCommands: { claude: [] } as unknown as Record<AgentKind, SlashCommand[]>,
      agentKind: 'claude' as AgentKind,
    }),
  );
  return { result, setMessage };
}

function pressKey(handler: (e: KeyboardEvent<Element>) => boolean, key: string) {
  act(() => {
    handler({ key, preventDefault: vi.fn() } as unknown as KeyboardEvent<Element>);
  });
}

describe('chat mentions', () => {
  it('suggests chats matching the query, excluding the current chat', () => {
    const { result } = renderSuggestions('@bug');

    expect(result.current.filteredChats.map((item) => item.path)).toEqual(['chat:chat-1']);
    expect(result.current.filteredChats[0]).toMatchObject({
      type: 'chat',
      name: 'Bugfix for the parser',
    });
  });

  it('lists the most recent chats for a bare @ query', () => {
    const { result } = renderSuggestions('@');

    expect(result.current.filteredChats.map((item) => item.path)).toEqual([
      'chat:chat-1',
      'chat:chat-2',
    ]);
  });

  it('inserts the plain-text @chat:<id> token when a chat is selected', () => {
    const { result, setMessage } = renderSuggestions('look at @bug');

    act(() => {
      result.current.selectMention(result.current.filteredChats[0]);
    });

    expect(setMessage).toHaveBeenCalledWith('look at @chat:chat-1 ');
  });

  it('keeps one keyboard index across the Files and Chats sections', () => {
    const { result, setMessage } = renderSuggestions('@bug');

    // Files come first in both the suggestion list and the panel sections.
    expect(result.current.filteredFiles.map((item) => item.path)).toEqual(['src/bugreport.ts']);
    expect(result.current.highlightedMentionIndex).toBe(0);

    // Index 1 is the first chat — the section boundary must not reset it.
    pressKey(result.current.handleMentionKeyDown, 'ArrowDown');
    expect(result.current.highlightedMentionIndex).toBe(1);

    pressKey(result.current.handleMentionKeyDown, 'Enter');
    expect(setMessage).toHaveBeenCalledWith('@chat:chat-1 ');

    // Wraps back to the first file rather than to the top of the Chats section.
    pressKey(result.current.handleMentionKeyDown, 'ArrowDown');
    expect(result.current.highlightedMentionIndex).toBe(0);
  });
});
