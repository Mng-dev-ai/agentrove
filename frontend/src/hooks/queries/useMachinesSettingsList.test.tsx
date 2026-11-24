// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsContext } from '@/contexts/SettingsContextDefinition';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useMachinesSettingsList } from '@/hooks/queries/useMachineQueries';
import { ServiceError } from '@/services/base/ServiceError';
import { settingsService } from '@/services/settingsService';
import { useMachineStore } from '@/store/machineStore';
import type { Persona, UserSettings } from '@/types/user.types';

const SELECTED_ID = 'selected';
const OTHER_ID = 'other';
const SELECTED_PERSONA: Persona = { name: 'Reviewer', content: 'Review carefully' };
const LOCAL_PERSONA: Persona = { name: 'Local', content: 'Local persona' };

function settingsWith(personas: Persona[]): UserSettings {
  return {
    id: 'settings',
    user_id: 'user',
    github_personal_access_token: null,
    custom_instructions: null,
    custom_env_vars: null,
    personas,
    stream_actions: null,
    notifications_enabled: false,
    notify_permission_requests: false,
    notify_questions: false,
    notify_completions: false,
    notify_inbox_messages: false,
    notify_sub_threads: false,
    auto_steer_queued_messages: false,
    title_model_id: 'model',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

const localSettings = settingsWith([LOCAL_PERSONA]);
const pending = () => new Promise<UserSettings>(() => {});

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsContext.Provider
        value={{
          localSettings,
          setLocalSettings: () => {},
          persistSettings: async () => {},
          settings: localSettings,
        }}
      >
        {children}
      </SettingsContext.Provider>
    </QueryClientProvider>
  );
}

function renderWithSelectedMachine() {
  const view = renderHook(() => useMachinesSettingsList('personas', 'No personas'), { wrapper });
  act(() => view.result.current.filter.categories[0].onChange(SELECTED_ID));
  expect(view.result.current.machineId).toBe(SELECTED_ID);
  return view;
}

describe('useMachinesSettingsList with a machine selected in the filter', () => {
  beforeEach(() => {
    queryClient = new QueryClient();
    useMachineStore.setState({
      machines: [
        { id: SELECTED_ID, name: 'Selected', url: 'https://selected.test', pairing: null },
        { id: OTHER_ID, name: 'Other', url: 'https://other.test', pairing: null },
      ],
      connections: { [SELECTED_ID]: { status: 'online' }, [OTHER_ID]: { status: 'online' } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
    useMachineStore.setState({ machines: [], connections: {} });
  });

  it('ignores a failing unselected machine', async () => {
    vi.spyOn(settingsService, 'getSettings').mockImplementation(async (machineId) => {
      if (machineId === OTHER_ID) throw new ServiceError('Forbidden', undefined, undefined, 403);
      return settingsWith([SELECTED_PERSONA]);
    });
    const { result } = renderWithSelectedMachine();

    await waitFor(() =>
      expect(result.current.items).toEqual([{ entry: SELECTED_PERSONA, machineId: SELECTED_ID }]),
    );
    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.machine.settings(OTHER_ID))?.status).toBe('error'),
    );
    expect(result.current.items).toEqual([{ entry: SELECTED_PERSONA, machineId: SELECTED_ID }]);
    expect(result.current.load.loadFailed).toBe(false);
    expect(result.current.load.isRetrying).toBe(false);
  });

  it('ignores a still-loading unselected machine', async () => {
    vi.spyOn(settingsService, 'getSettings').mockImplementation((machineId) =>
      machineId === OTHER_ID ? pending() : Promise.resolve(settingsWith([SELECTED_PERSONA])),
    );
    const { result } = renderWithSelectedMachine();

    await waitFor(() =>
      expect(result.current.items).toEqual([{ entry: SELECTED_PERSONA, machineId: SELECTED_ID }]),
    );
    expect(result.current.load.loadFailed).toBe(false);
  });

  it('returns null while the selected machine is loading', async () => {
    vi.spyOn(settingsService, 'getSettings').mockImplementation((machineId) =>
      machineId === SELECTED_ID ? pending() : Promise.resolve(settingsWith([])),
    );
    const { result } = renderWithSelectedMachine();

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.machine.settings(OTHER_ID))?.status).toBe(
        'success',
      ),
    );
    expect(result.current.items).toBeNull();
  });
});
