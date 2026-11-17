// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { permissionNotifyEvent, useBackgroundNotify } from './useBackgroundNotify';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useUIStore } from '@/store/uiStore';
import type { TileId } from '@/types/ui.types';
import type { UserSettings } from '@/types/user.types';
import type { Chat } from '@/types/chat.types';
import { chatService } from '@/services/chatService';
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

function setNotificationSettings(over: Partial<UserSettings> = {}) {
  queryClient.setQueryData([queryKeys.settings], {
    notifications_enabled: true,
    notify_permission_requests: true,
    notify_questions: true,
    notify_completions: true,
    notify_sub_threads: true,
    ...over,
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
  setNotificationSettings();
  notify.mockResolvedValue(true);
  setLayout({});
});

describe('useBackgroundNotify', () => {
  it('suppresses while the target chat is painted in a focused window', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-1', 'notify_completions', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies when the window is unfocused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    setRoute('/chat/chat-1');
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-1', 'notify_completions', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('notifies for a chat in a hidden split tab even when focused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    setLayout({ visibleLayout: [['agent:primary']], splitChatIds: ['chat-2'] });
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-2', 'notify_completions', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('notifies from a route that mounts no tiles, whatever the persisted layout says', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/settings');
    setLayout({ visibleLayout: [['agent:primary', 'agent:split-1']], splitChatIds: ['chat-2'] });
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-2', 'notify_completions', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('suppresses a split chat painted on the landing route', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/');
    setLayout({ visibleLayout: [['agent:primary', 'agent:split-1']], splitChatIds: ['chat-2'] });
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-2', 'notify_completions', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('suppresses a split chat that is painted on screen', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    setLayout({ visibleLayout: [['agent:primary', 'agent:split-1']], splitChatIds: ['chat-2'] });
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-2', 'notify_completions', notify);
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

    result.current.notifyBackground('/chat/chat-2', 'notify_completions', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("suppresses when the chat's non-agent tile is painted (full-screen diff)", async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    setLayout({ visibleLayout: [['diff']] });
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-1', 'notify_completions', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies for sub-threads, which are never painted as tiles', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/sub-thread-1', 'notify_completions', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not notify when notifications are disabled in settings', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    setNotificationSettings({ notifications_enabled: false });
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-1', 'notify_completions', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  const events = ['notify_permission_requests', 'notify_questions', 'notify_completions'] as const;

  it.each(events)('with %s off, only that event is suppressed', async (off) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    setNotificationSettings({ [off]: false });
    const { result } = renderNotify();
    const delivered: string[] = [];

    for (const event of events) {
      result.current.notifyBackground('/chat/chat-1', event, async () => {
        delivered.push(event);
        return true;
      });
    }
    await flush();
    expect(delivered).toEqual(events.filter((event) => event !== off));
  });

  it('classifies AskUserQuestion as a question and other tools as permission requests', () => {
    expect(permissionNotifyEvent('AskUserQuestion')).toBe('notify_questions');
    expect(permissionNotifyEvent('ExitPlanMode')).toBe('notify_permission_requests');
    expect(permissionNotifyEvent('Bash')).toBe('notify_permission_requests');
  });

  it('with sub-threads off, waits for an uncached chat and drops only sub-thread events', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    setNotificationSettings({ notify_sub_threads: false });
    let resolveSubThread: (chat: Chat) => void = () => {};
    vi.spyOn(chatService, 'getChat').mockImplementation((chatId: string) =>
      chatId === 'sub-thread-1'
        ? new Promise((resolve) => (resolveSubThread = resolve))
        : Promise.resolve({ id: chatId, parent_chat_id: null } as Chat),
    );
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/sub-thread-1', 'notify_completions', notify);
    await flush();
    resolveSubThread({ id: 'sub-thread-1', parent_chat_id: 'chat-1' } as Chat);
    await flush();
    expect(notify).not.toHaveBeenCalled();

    result.current.notifyBackground('/chat/top-level-1', 'notify_completions', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('never looks the chat up while sub-threads are on', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const getChat = vi.spyOn(chatService, 'getChat');
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/uncached-1', 'notify_completions', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getChat).not.toHaveBeenCalled();
  });

  it('routes clicks to the chat and badges the delivered notification', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-2', 'notify_completions', notify);
    await flush();
    expect(setAppBadge).toHaveBeenCalledTimes(1);

    act(() => notify.mock.calls[0][0].onClick?.());
    expect(result.current.location.pathname).toBe('/chat/chat-2');
  });

  it('does not badge when the user returns to the app mid-delivery', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValueOnce(false).mockReturnValue(true);
    setRoute('/chat/chat-1');
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-1', 'notify_completions', notify);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it('does not badge a notification the OS never showed', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    notify.mockResolvedValue(false);
    const { result } = renderNotify();

    result.current.notifyBackground('/chat/chat-2', 'notify_completions', notify);
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
    staleNotifyBackground('/chat/chat-1', 'notify_completions', notify);
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
    staleNotifyBackground('/chat/chat-2', 'notify_completions', notify);
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });
});
