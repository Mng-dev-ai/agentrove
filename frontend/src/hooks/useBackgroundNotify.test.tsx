// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBackgroundNotify } from './useBackgroundNotify';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useUIStore } from '@/store/uiStore';
import type { TileId } from '@/types/ui.types';
import type { UserSettings } from '@/types/user.types';
import type { NotifyOptions } from '@/utils/notifications';

const setAppBadge = vi.fn(async () => {});
Object.defineProperty(navigator, 'setAppBadge', { value: setAppBadge, configurable: true });

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

const notify = vi.fn<(options: NotifyOptions) => Promise<boolean>>(async () => true);

const flush = () => new Promise((r) => setTimeout(r, 0));

function renderNotify() {
  return renderHook(() => ({ notifyBackground: useBackgroundNotify(), location: useLocation() }), {
    wrapper,
  });
}

function setRoute(path: string) {
  window.history.replaceState({}, '', path);
}

function setNotificationsEnabled(enabled: boolean) {
  queryClient.setQueryData([queryKeys.settings], {
    notifications_enabled: enabled,
  } as UserSettings);
}

function setLayout(over: {
  visibleLayout?: TileId[][];
  focusedTile?: TileId | null;
  splitChatIds?: string[];
}) {
  useUIStore.setState({
    visibleLayout: [['agent:primary']],
    focusedTile: null,
    splitChatIds: [],
    ...over,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.innerWidth = 1280;
  setRoute('/');
  setNotificationsEnabled(true);
  notify.mockResolvedValue(true);
  setLayout({});
});

describe('useBackgroundNotify', () => {
  it('suppresses while the target chat is painted in a focused window', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result } = renderNotify();

    result.current.notifyBackground('chat-1', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies when the window is unfocused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    setRoute('/chat/chat-1');
    const { result } = renderNotify();

    result.current.notifyBackground('chat-1', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('notifies for a chat in a hidden split tab even when focused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    setLayout({ visibleLayout: [['agent:primary']], splitChatIds: ['chat-2'] });
    const { result } = renderNotify();

    result.current.notifyBackground('chat-2', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('notifies from a route that mounts no tiles, whatever the persisted layout says', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/settings');
    setLayout({ visibleLayout: [['agent:primary', 'agent:split-1']], splitChatIds: ['chat-2'] });
    const { result } = renderNotify();

    result.current.notifyBackground('chat-2', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('suppresses a split chat painted on the landing route', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/');
    setLayout({ visibleLayout: [['agent:primary', 'agent:split-1']], splitChatIds: ['chat-2'] });
    const { result } = renderNotify();

    result.current.notifyBackground('chat-2', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('suppresses a split chat that is painted on screen', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    setLayout({ visibleLayout: [['agent:primary', 'agent:split-1']], splitChatIds: ['chat-2'] });
    const { result } = renderNotify();

    result.current.notifyBackground('chat-2', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('on mobile only the focused tile counts as painted', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    window.innerWidth = 400;
    setRoute('/chat/chat-1');
    setLayout({
      visibleLayout: [['agent:primary', 'agent:split-1']],
      splitChatIds: ['chat-2'],
      focusedTile: 'agent:primary',
    });
    const { result } = renderNotify();

    result.current.notifyBackground('chat-2', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("suppresses when the chat's non-agent tile is painted (full-screen diff)", async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    setLayout({ visibleLayout: [['diff']] });
    const { result } = renderNotify();

    result.current.notifyBackground('chat-1', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies for sub-threads, which are never painted as tiles', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result } = renderNotify();

    result.current.notifyBackground('sub-thread-1', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not notify when notifications are disabled in settings', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    setNotificationsEnabled(false);
    const { result } = renderNotify();

    result.current.notifyBackground('chat-1', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('routes clicks to the chat and badges the delivered notification', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { result } = renderNotify();

    result.current.notifyBackground('chat-2', notify);
    await flush();
    expect(setAppBadge).toHaveBeenCalledTimes(1);

    act(() => notify.mock.calls[0][0].onClick?.());
    expect(result.current.location.pathname).toBe('/chat/chat-2');
  });

  it('does not badge when the user returns to the app mid-delivery', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValueOnce(false).mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result } = renderNotify();

    result.current.notifyBackground('chat-1', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it('does not badge a notification the OS never showed', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    notify.mockResolvedValue(false);
    const { result } = renderNotify();

    result.current.notifyBackground('chat-2', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it('reads the live route even from closures that outlived their pane', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result, unmount } = renderNotify();
    const staleNotifyBackground = result.current.notifyBackground;
    unmount();

    setRoute('/chat/chat-2');
    staleNotifyBackground('chat-1', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('still suppresses from an outlived closure when the target is on screen', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result, unmount } = renderNotify();
    const staleNotifyBackground = result.current.notifyBackground;
    unmount();

    setRoute('/chat/chat-2');
    staleNotifyBackground('chat-2', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });
});
