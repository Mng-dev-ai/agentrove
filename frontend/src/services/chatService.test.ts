// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatService } from './chatService';
import { useMachineStore } from '@/store/machineStore';
import { assignChatsToMachine, chatMachineId } from '@/store/machineOrigin';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { PaginatedChats } from '@/types/api.types';

const CHAT_ID = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';
const chat = { id: CHAT_ID, sandbox_id: 'sbx-remote', title: 'Remote' };

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (input) =>
    String(input).startsWith('https://vps.ts.net/')
      ? new Response(JSON.stringify(chat))
      : new Response(JSON.stringify({ detail: 'Chat not found' }), { status: 404 }),
  );
  const store = useMachineStore.getState();
  for (const id of ['offline', 'vps']) {
    store.addMachine({ id, name: id, url: `https://${id}.ts.net`, pairing: null });
  }
  store.setConnection('vps', { status: 'online' });
  store.setConnection('offline', { status: 'offline' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listChats', () => {
  it('corrects removed-machine origins while preserving paired-machine origins', async () => {
    const chatA = 'c8e424e1-8390-433e-a762-eeb03b72df51';
    const chatB = 'e60bca52-d05a-40f5-a597-65718530805e';
    const store = useMachineStore.getState();
    store.addMachine({ id: 'gone', name: 'gone', url: 'https://gone.ts.net', pairing: null });
    assignChatsToMachine('gone', [chatA]);
    store.removeMachine('gone');
    assignChatsToMachine('vps', [chatB]);

    const page: PaginatedChats = {
      items: [chatA, chatB].map((id) => ({
        id,
        user_id: 'user',
        title: 'Pinned chat',
        workspace_id: 'workspace',
        sandbox_id: `sandbox-${id}`,
        created_at: '2026-11-07T00:00:00Z',
        updated_at: '2026-11-07T00:00:00Z',
        pinned_at: '2026-11-07T00:00:00Z',
        worktree_cwd: null,
        parent_chat_id: null,
        channel_id: null,
        sub_thread_count: 0,
        session_agent_kind: null,
        unread: false,
        last_model_id: null,
        last_thinking_mode: null,
        last_persona_name: null,
      })),
      page: 1,
      per_page: 20,
      total: 2,
      pages: 1,
    };
    fetchMock.mockImplementation(async (input) =>
      new URL(String(input)).pathname.endsWith('/chat/chats')
        ? new Response(JSON.stringify(page))
        : new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 }),
    );

    await chatService.listChats();

    expect(chatMachineId(chatA)).toBe(LOCAL_MACHINE_ID);
    expect(chatMachineId(chatB)).toBe('vps');
  });
});

describe('getChat', () => {
  it('finds an unmapped chat on an online machine after a local 404 and routes it there', async () => {
    await expect(chatService.getChat(CHAT_ID)).resolves.toMatchObject({ id: CHAT_ID });

    expect(chatMachineId(CHAT_ID)).toBe('vps');
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).host)).not.toContain(
      'offline.ts.net',
    );
  });
});
