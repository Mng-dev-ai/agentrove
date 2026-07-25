// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NotifyOptions } from '@/utils/notifications';

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  isMobile: { value: false },
  fetchNotificationsEnabled: vi.fn(async () => true),
  bumpAppBadge: vi.fn(async () => {}),
}));

// Partial mock: matchPath stays real so the live-route read is exercised.
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('@/hooks/useIsMobile', () => ({ isMobileViewport: () => h.isMobile.value }));
vi.mock('@/hooks/queries/useSettingsQueries', () => ({
  fetchNotificationsEnabled: h.fetchNotificationsEnabled,
}));
vi.mock('@/utils/notifications', () => ({ bumpAppBadge: h.bumpAppBadge }));

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBackgroundNotify } from './useBackgroundNotify';
import { useUIStore } from '@/store/uiStore';
import type { TileId } from '@/types/ui.types';

const testQueryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
);

const notify = vi.fn<(options: NotifyOptions) => Promise<boolean>>(async () => true);

// The notify handoff sits behind the async settings gate.
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function setRoute(path: string) {
  window.history.replaceState({}, '', path);
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
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setRoute('/');
  h.isMobile.value = false;
  h.fetchNotificationsEnabled.mockResolvedValue(true);
  notify.mockResolvedValue(true);
  setLayout({});
});

describe('useBackgroundNotify', () => {
  it('suppresses while the target chat is painted in a focused window', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-1', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies when the window is unfocused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    setRoute('/chat/chat-1');
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-1', notify);
    await flush();
    expect(notify).toHaveBeenCalledWith({ onClick: expect.any(Function) });
  });

  it('notifies for a chat in a hidden split tab even when focused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    // chat-2 is bound to slot 1, but its tile is not in the visible layout.
    setLayout({ visibleLayout: [['agent:primary']], splitChatIds: ['chat-2'] });
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-2', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('notifies from a route that mounts no tiles, whatever the persisted layout says', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/settings');
    setLayout({ visibleLayout: [['agent:primary', 'agent:split-1']], splitChatIds: ['chat-2'] });
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-2', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('suppresses a split chat painted on the landing route', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/');
    setLayout({ visibleLayout: [['agent:primary', 'agent:split-1']], splitChatIds: ['chat-2'] });
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-2', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('suppresses a split chat that is painted on screen', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    setLayout({ visibleLayout: [['agent:primary', 'agent:split-1']], splitChatIds: ['chat-2'] });
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-2', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('on mobile only the focused tile counts as painted', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    h.isMobile.value = true;
    setRoute('/chat/chat-1');
    setLayout({
      visibleLayout: [['agent:primary', 'agent:split-1']],
      splitChatIds: ['chat-2'],
      focusedTile: 'agent:primary',
    });
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-2', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("suppresses when the chat's non-agent tile is painted (full-screen diff)", async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    setLayout({ visibleLayout: [['diff']] });
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-1', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies for sub-threads, which are never painted as tiles', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('sub-thread-1', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not notify when notifications are disabled in settings', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    h.fetchNotificationsEnabled.mockResolvedValue(false);
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-1', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('routes clicks to the chat and badges the delivered notification', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-2', notify);
    await flush();
    expect(h.bumpAppBadge).toHaveBeenCalledTimes(1);

    notify.mock.calls[0][0].onClick?.();
    expect(h.navigate).toHaveBeenCalledWith('/chat/chat-2');
  });

  it('does not badge when the user returns to the app mid-delivery', async () => {
    // Unfocused at the gate, focused again by the time delivery resolves.
    vi.spyOn(document, 'hasFocus').mockReturnValueOnce(false).mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-1', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(h.bumpAppBadge).not.toHaveBeenCalled();
  });

  it('does not badge a notification the OS never showed', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    notify.mockResolvedValue(false);
    const { result } = renderHook(() => useBackgroundNotify(), { wrapper });

    result.current('chat-2', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(h.bumpAppBadge).not.toHaveBeenCalled();
  });

  it('reads the live route even from closures that outlived their pane', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result, unmount } = renderHook(() => useBackgroundNotify(), { wrapper });
    const staleNotifyBackground = result.current;
    unmount();

    // Pane gone, user navigated on; chat-1 is no longer painted anywhere.
    setRoute('/chat/chat-2');
    staleNotifyBackground('chat-1', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('still suppresses from an outlived closure when the target is on screen', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result, unmount } = renderHook(() => useBackgroundNotify(), { wrapper });
    const staleNotifyBackground = result.current;
    unmount();

    setRoute('/chat/chat-2');
    staleNotifyBackground('chat-2', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });
});
