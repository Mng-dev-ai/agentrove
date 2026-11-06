// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;

async function load(machineIds: string[] = []) {
  vi.resetModules();
  const origin = await import('@/store/machineOrigin');
  const migration = await import('@/services/legacyCloudMigration');
  const { useMachineStore } = await import('@/store/machineStore');
  for (const id of machineIds) {
    useMachineStore
      .getState()
      .addMachine({ id, name: id, url: `https://${id}.ts.net`, pairing: null });
  }
  return { ...origin, ...migration, useMachineStore };
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('machine origin maps', () => {
  it('routes unknown ids to the local machine', async () => {
    const { chatMachineId, sandboxMachineId } = await load();
    expect(chatMachineId('unknown')).toBe('local');
    expect(chatMachineId(undefined)).toBe('local');
    expect(sandboxMachineId('unknown')).toBe('local');
  });

  it('never reassigns an id another machine already owns', async () => {
    const { assignChatsToMachine, assignSandboxesToMachine, chatMachineId, sandboxMachineId } =
      await load(['vps', 'ec2']);
    assignChatsToMachine('local', ['shared-chat']);
    assignChatsToMachine('vps', ['shared-chat', 'vps-chat']);
    assignSandboxesToMachine('vps', ['sbx']);
    assignSandboxesToMachine('ec2', ['sbx']);

    expect(chatMachineId('shared-chat')).toBe('local');
    expect(chatMachineId('vps-chat')).toBe('vps');
    expect(sandboxMachineId('sbx')).toBe('vps');
    expect(stored('machine-chat-origins')).toEqual({ 'shared-chat': 'local', 'vps-chat': 'vps' });
  });

  it('frees a removed machine’s ids without touching other machines', async () => {
    const { assignChatsToMachine, forgetMachineOrigins, chatMachineId } = await load([
      'vps',
      'ec2',
    ]);
    assignChatsToMachine('vps', ['a']);
    assignChatsToMachine('ec2', ['b']);
    forgetMachineOrigins('vps');
    expect(chatMachineId('a')).toBe('local');
    expect(chatMachineId('b')).toBe('ec2');
  });

  it('ignores late ids for a machine that is no longer in the store', async () => {
    const { assignChatRecordsToMachine, chatMachineId, sandboxMachineId, useMachineStore } =
      await load(['vps']);
    useMachineStore.getState().removeMachine('vps');
    assignChatRecordsToMachine('vps', [{ id: 'late', sandbox_id: 'sbx' }]);
    expect(chatMachineId('late')).toBe('local');
    expect(sandboxMachineId('sbx')).toBe('local');
    expect(stored('machine-chat-origins')).toBeNull();
  });
});

describe('legacy cloud migration', () => {
  const seedLegacy = () => {
    localStorage.setItem(
      'cloud-settings-storage',
      JSON.stringify({ state: { cloudUrl: 'https://vps.tail1.ts.net/', connectedEmail: 'me@x' } }),
    );
    localStorage.setItem('cloud_refresh_token', 'legacy-refresh');
    localStorage.setItem('cloud-chat-ids', JSON.stringify(['c1', 'c2', 7]));
    localStorage.setItem('cloud-sandbox-ids', JSON.stringify(['s1']));
  };

  it('maps legacy cloud ids to a Cloud machine, revokes the token, and clears legacy keys', async () => {
    seedLegacy();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { migrateLegacyCloud, chatMachineId, sandboxMachineId, useMachineStore } = await load();

    await migrateLegacyCloud();

    expect(useMachineStore.getState().machines).toEqual([
      expect.objectContaining({
        id: 'legacy-cloud',
        name: 'Cloud',
        pairing: null,
        url: 'https://vps.tail1.ts.net',
      }),
    ]);
    expect(chatMachineId('c1')).toBe('legacy-cloud');
    expect(chatMachineId('c2')).toBe('legacy-cloud');
    expect(sandboxMachineId('s1')).toBe('legacy-cloud');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://vps.tail1.ts.net/api/v1/auth/jwt/logout',
      expect.objectContaining({ body: JSON.stringify({ refresh_token: 'legacy-refresh' }) }),
    );
    for (const key of [
      'cloud-settings-storage',
      'cloud_refresh_token',
      'cloud-chat-ids',
      'cloud-sandbox-ids',
    ]) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it('finishes cleanup when re-run after an interrupted pass, without duplicating the machine', async () => {
    seedLegacy();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')));
    const first = await load();
    first.assignChatsToMachine('local', ['c2']);
    await first.migrateLegacyCloud();
    localStorage.setItem(
      'cloud-settings-storage',
      JSON.stringify({ state: { cloudUrl: 'https://vps.tail1.ts.net' } }),
    );
    localStorage.setItem('cloud-chat-ids', JSON.stringify(['c1', 'c2']));

    const second = await load();
    await second.migrateLegacyCloud();

    expect(second.useMachineStore.getState().machines).toHaveLength(1);
    expect(second.chatMachineId('c1')).toBe('legacy-cloud');
    expect(second.chatMachineId('c2')).toBe('local');
    expect(localStorage.getItem('cloud-settings-storage')).toBeNull();
    expect(localStorage.getItem('cloud-chat-ids')).toBeNull();
  });
});

describe('pairing the migrated Cloud machine', () => {
  const failureOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { failure?: unknown }) => error.failure,
    );

  it('offers to pair it again instead of adding the same server twice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ status: 'healthy', instance_id: 'vps-1' })),
      ),
    );
    const { useMachineStore } = await load(['cloud']);
    useMachineStore.getState().updateMachine('cloud', { url: 'https://vps.tail1.ts.net' });
    const { pairMachine } = await import('@/services/machineActions');

    expect(
      await failureOf(
        pairMachine({ mode: 'add', name: 'VPS', link: 'https://vps.tail1.ts.net/#pair=s' }),
      ),
    ).toEqual({ kind: 'unpaired_duplicate', machineId: 'cloud', name: 'cloud' });
    expect(
      await failureOf(
        pairMachine({ mode: 'repair', machineId: 'cloud', link: 'https://other.ts.net/#pair=s' }),
      ),
    ).toEqual({ kind: 'different_server', origin: 'https://other.ts.net' });
  });
});
