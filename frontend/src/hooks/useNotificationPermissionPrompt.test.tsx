// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNotificationPermissionPrompt } from './useNotificationPermissionPrompt';
import { queryKeys } from '@/hooks/queries/queryKeys';
import type { UserSettings } from '@/types/user.types';

const requestPermission = vi.fn(async () => 'default' as NotificationPermission);
let queryClient: QueryClient;

function setSettings(notificationsEnabled: boolean) {
  queryClient.setQueryData([queryKeys.settings], {
    notifications_enabled: notificationsEnabled,
  } as UserSettings);
}

function renderPrompt() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useNotificationPermissionPrompt(true), { wrapper });
}

function gesture() {
  window.dispatchEvent(new Event('pointerdown'));
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setSettings(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useNotificationPermissionPrompt', () => {
  it('asks synchronously inside the first gesture, and only once', () => {
    renderPrompt();

    gesture();
    // Synchronous assert — an await sneaking into the handler breaks this.
    expect(requestPermission).toHaveBeenCalledTimes(1);

    gesture();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('does not arm until settings resolve, then arms once they land', async () => {
    queryClient.clear();
    renderPrompt();

    gesture();
    expect(requestPermission).not.toHaveBeenCalled();

    act(() => setSettings(true));
    await waitFor(() => {
      gesture();
      expect(requestPermission).toHaveBeenCalledTimes(1);
    });
  });

  it('does not arm while notifications are disabled', () => {
    setSettings(false);
    renderPrompt();

    gesture();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('does not arm once permission is decided', () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission });
    renderPrompt();

    gesture();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('does not arm in Tauri', () => {
    vi.stubGlobal('isTauri', true);
    renderPrompt();

    gesture();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('disarms on unmount', () => {
    const { unmount } = renderPrompt();
    unmount();

    gesture();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
