// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  settings: { data: undefined as { notifications_enabled: boolean } | undefined },
  requestNotificationPermission: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: h.isTauri }));
vi.mock('@/hooks/queries/useSettingsQueries', () => ({ useSettingsQuery: () => h.settings }));
vi.mock('@/utils/notifications', () => ({
  requestNotificationPermission: h.requestNotificationPermission,
}));

import { useNotificationPermissionPrompt } from './useNotificationPermissionPrompt';

beforeEach(() => {
  vi.clearAllMocks();
  h.isTauri.mockReturnValue(false);
  h.settings.data = { notifications_enabled: true };
  vi.stubGlobal('Notification', { permission: 'default' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function gesture() {
  window.dispatchEvent(new Event('pointerdown'));
}

describe('useNotificationPermissionPrompt', () => {
  it('asks synchronously inside the first gesture, and only once', () => {
    renderHook(() => useNotificationPermissionPrompt(true));

    gesture();
    // Synchronous assert — an await sneaking into the handler breaks this.
    expect(h.requestNotificationPermission).toHaveBeenCalledTimes(1);

    gesture();
    expect(h.requestNotificationPermission).toHaveBeenCalledTimes(1);
  });

  it('does not arm until settings resolve, then arms once they land', () => {
    h.settings.data = undefined;
    const { rerender } = renderHook(() => useNotificationPermissionPrompt(true));

    gesture();
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();

    h.settings.data = { notifications_enabled: true };
    rerender();
    gesture();
    expect(h.requestNotificationPermission).toHaveBeenCalledTimes(1);
  });

  it('does not arm while notifications are disabled', () => {
    h.settings.data = { notifications_enabled: false };
    renderHook(() => useNotificationPermissionPrompt(true));

    gesture();
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('does not arm once permission is decided', () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    renderHook(() => useNotificationPermissionPrompt(true));

    gesture();
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('does not arm in Tauri', () => {
    h.isTauri.mockReturnValue(true);
    renderHook(() => useNotificationPermissionPrompt(true));

    gesture();
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('disarms on unmount', () => {
    const { unmount } = renderHook(() => useNotificationPermissionPrompt(true));
    unmount();

    gesture();
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();
  });
});
