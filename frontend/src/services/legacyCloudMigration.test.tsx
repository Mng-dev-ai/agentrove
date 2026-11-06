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

function fakeMachineServer(host: string, instanceId: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = `e30.${btoa(JSON.stringify({ exp }))}.sig`;
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (!url.startsWith(`https://${host}/`)) {
      return new Response(JSON.stringify({ instance_id: 'local-instance' }));
    }
    const path = new URL(url).pathname;
    if (path === '/health') return new Response(JSON.stringify({ status: 'healthy' }));
    if (path === '/api/v1/instance')
      return new Response(JSON.stringify({ instance_id: instanceId }));
    if (path === '/api/v1/auth/pair') {
      return new Response(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh',
          device_id: 'new-device',
          instance_id: instanceId,
        }),
      );
    }
    return new Response(JSON.stringify({ id: 'vps-chat' }));
  });
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

  const pairing = (instanceId: string) => ({
    instanceId,
    deviceId: `device-${instanceId}`,
    pairedAt: '2026-01-01T00:00:00Z',
  });

  async function removePairedMachines() {
    const loaded = await load();
    const store = loaded.useMachineStore.getState();
    for (const [id, instanceId] of [
      ['vps', 'vps-instance'],
      ['ec2', 'ec2-instance'],
    ]) {
      store.addMachine({ id, name: id, url: `https://${id}.ts.net`, pairing: pairing(instanceId) });
      store.setConnection(id, { status: 'offline' });
    }
    loaded.assignChatRecordsToMachine('vps', [{ id: 'vps-chat', sandbox_id: 'vps-sbx' }]);
    loaded.assignChatsToMachine('ec2', ['ec2-chat']);
    const { removeMachine } = await import('@/services/machineActions');
    await removeMachine('vps');
    await removeMachine('ec2');
    return loaded;
  }

  it('keeps a removed machine’s chats on it so no other machine gets their requests', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const { chatMachineId } = await removePairedMachines();
    const { resolveChatClient, resolveSandboxClient } = await import('@/lib/api');
    const { MachineUnavailableError } = await import('@/services/machineSession');
    const { machineName } = await import('@/store/machineStore');

    await expect(resolveChatClient('vps-chat').get('/chat/chats/vps-chat')).rejects.toBeInstanceOf(
      MachineUnavailableError,
    );
    await expect(resolveSandboxClient('vps-sbx').get('/sandbox/vps-sbx')).rejects.toBeInstanceOf(
      MachineUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(machineName(chatMachineId('vps-chat'))).toBe('Removed machine');
  });

  it('routes a removed machine’s chats to a new pairing with the same server', async () => {
    const { chatMachineId, sandboxMachineId } = await removePairedMachines();
    const fetchMock = fakeMachineServer('vps.ts.net', 'vps-instance');
    vi.stubGlobal('fetch', fetchMock);
    const { pairMachine } = await import('@/services/machineActions');
    const { resolveChatClient } = await import('@/lib/api');

    const machine = await pairMachine({
      mode: 'add',
      name: 'VPS again',
      link: 'https://vps.ts.net/#pair=secret',
    });

    expect(chatMachineId('vps-chat')).toBe(machine.id);
    expect(sandboxMachineId('vps-sbx')).toBe(machine.id);
    expect(chatMachineId('ec2-chat')).toBe('ec2');
    await resolveChatClient('vps-chat').get('/chat/chats/vps-chat');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://vps.ts.net/api/v1/chat/chats/vps-chat',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('keeps assignments it could not save when a later one is saved', async () => {
    const { assignChatsToMachine, chatMachineId } = await load(['vps', 'ec2']);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    assignChatsToMachine('vps', ['vps-chat']);
    setItem.mockRestore();

    assignChatsToMachine('ec2', ['ec2-chat']);

    expect(chatMachineId('vps-chat')).toBe('vps');
    expect(chatMachineId('ec2-chat')).toBe('ec2');
    expect(stored('machine-chat-origins')).toEqual({ 'vps-chat': 'vps', 'ec2-chat': 'ec2' });
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

describe('two tabs', () => {
  const loadTab = async () => {
    vi.resetModules();
    return {
      ...(await import('@/store/machineOrigin')),
      ...(await import('@/store/machineStore')),
    };
  };

  it('does not resurrect a mapping another tab claimed', async () => {
    localStorage.setItem('machine-chat-origins', JSON.stringify({ 'vps-chat': 'old-vps' }));
    localStorage.setItem(
      'machine-removed-identities',
      JSON.stringify({ 'old-vps': 'instance:vps-instance' }),
    );
    const tabA = await loadTab();
    const tabB = await loadTab();

    tabA.claimRemovedMachineOrigins('new-vps', [{ instanceId: 'vps-instance' }]);
    tabB.assignChatsToMachine('local', ['local-chat']);

    expect(stored('machine-chat-origins')).toEqual({
      'vps-chat': 'new-vps',
      'local-chat': 'local',
    });
    expect(tabB.chatMachineId('vps-chat')).toBe('new-vps');
  });

  it('keeps machines another tab added when this tab persists', async () => {
    const tabA = await loadTab();
    const tabB = await loadTab();
    const otherTabWrote = async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'machines-storage' }));
      await Promise.resolve();
    };
    tabB.useMachineStore
      .getState()
      .addMachine({ id: 'vps', name: 'vps', url: 'https://vps.ts.net', pairing: null });
    await otherTabWrote();

    tabA.useMachineStore
      .getState()
      .addMachine({ id: 'ec2', name: 'ec2', url: 'https://ec2.ts.net', pairing: null });
    await otherTabWrote();
    tabB.useMachineStore.getState().setConnection('vps', { status: 'online' });

    const persisted = stored('machines-storage') as { state: { machines: { id: string }[] } };
    expect(persisted.state.machines.map((machine) => machine.id).sort()).toEqual(['ec2', 'vps']);
    expect(tabB.getMachine('ec2')).toBeDefined();
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

  it('lets a new pairing with the same server take over a removed Cloud machine’s chats', async () => {
    seedLegacy();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null)));
    const { migrateLegacyCloud, chatMachineId, sandboxMachineId } = await load();
    await migrateLegacyCloud();
    const { pairMachine, removeMachine } = await import('@/services/machineActions');
    await removeMachine('legacy-cloud');
    vi.stubGlobal('fetch', fakeMachineServer('vps.tail1.ts.net', 'vps-instance'));

    const machine = await pairMachine({
      mode: 'add',
      name: 'VPS',
      link: 'https://vps.tail1.ts.net/#pair=secret',
    });

    expect(chatMachineId('c1')).toBe(machine.id);
    expect(sandboxMachineId('s1')).toBe(machine.id);
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

describe('unconvertible legacy cloud URL', () => {
  it.each(['http://vps.tail1.ts.net', 'https://vps.tail1.ts.net/agentrove'])(
    'keeps %s and its session in place and shows the notice until dismissed',
    async (cloudUrl) => {
      localStorage.setItem('cloud-settings-storage', JSON.stringify({ state: { cloudUrl } }));
      localStorage.setItem('cloud_refresh_token', 'legacy-refresh');
      localStorage.setItem('cloud-chat-ids', JSON.stringify(['c1']));
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      const { migrateLegacyCloud, chatMachineId, useMachineStore } = await load();
      const { MachinesSettingsTab } =
        await import('@/components/settings/tabs/MachinesSettingsTab/MachinesSettingsTab');
      const { render, screen, fireEvent } = await import('@testing-library/react');
      const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
      const renderTab = () =>
        render(
          <QueryClientProvider client={new QueryClient()}>
            <MachinesSettingsTab />
          </QueryClientProvider>,
        );

      await migrateLegacyCloud();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(useMachineStore.getState().machines).toEqual([]);
      expect(chatMachineId('c1')).toBe('local');
      for (const key of ['cloud-settings-storage', 'cloud_refresh_token', 'cloud-chat-ids']) {
        expect(localStorage.getItem(key)).not.toBeNull();
      }
      const view = renderTab();
      expect(screen.getByText(new RegExp(`add ${cloudUrl} again over https`, 'i'))).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
      view.unmount();
      renderTab();
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    },
  );
});

describe('pairing the migrated Cloud machine', () => {
  const failureOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { failure?: unknown }) => error.failure,
    );

  const stubServers = (localInstanceId: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async (input) =>
          new Response(
            JSON.stringify({
              status: 'healthy',
              instance_id: String(input).startsWith('https://') ? 'vps-1' : localInstanceId,
            }),
          ),
      ),
    );

  it('refuses a pairing link for the server this app runs on', async () => {
    stubServers('vps-1');
    await load();
    const { pairMachine } = await import('@/services/machineActions');

    expect(
      await failureOf(
        pairMachine({ mode: 'add', name: 'Self', link: 'https://vps.tail1.ts.net/#pair=s' }),
      ),
    ).toEqual({ kind: 'own_server' });
  });

  it('offers to pair it again instead of adding the same server twice', async () => {
    stubServers('local-1');
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
