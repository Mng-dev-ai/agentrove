// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatService } from './chatService';
import { useMachineStore } from '@/store/machineStore';
import { chatMachineId } from '@/store/machineOrigin';

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

describe('getChat', () => {
  it('finds an unmapped chat on an online machine after a local 404 and routes it there', async () => {
    await expect(chatService.getChat(CHAT_ID)).resolves.toMatchObject({ id: CHAT_ID });

    expect(chatMachineId(CHAT_ID)).toBe('vps');
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).host)).not.toContain(
      'offline.ts.net',
    );
  });
});
