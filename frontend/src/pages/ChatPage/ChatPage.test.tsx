// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUIStore } from '@/store/uiStore';
import { ChatPage } from './ChatPage';

vi.mock('@/components/layout/Sidebar/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/Layout/layoutState', () => ({ useLayoutSidebar: () => {} }));
vi.mock('@/hooks/useCommandMenu', () => ({ useCommandMenu: () => {} }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useChatData', () => ({
  useChatData: () => ({
    currentChat: undefined,
    fetchedMessages: [],
    hasFetchedMessages: true,
    messagesQuery: {},
  }),
}));
vi.mock('@/hooks/queries/useChatQueries', () => ({
  useChatQuery: () => ({ data: undefined, isError: false }),
  markChatViewed: () => Promise.resolve(),
}));
vi.mock('@/hooks/useSandboxFiles', () => ({
  useSandboxFiles: () => ({ fileStructure: [], refetchFilesMetadata: () => {} }),
}));
vi.mock('@/hooks/queries/useWorkspaceQueries', () => ({
  useWorkspacesList: () => [],
  useWorkspaceResourcesQuery: () => ({ data: undefined }),
}));
vi.mock('@/hooks/queries/useMachineQueries', () => ({
  useMachineWorkspacesQuery: () => ({ data: undefined }),
}));
vi.mock('@/hooks/queries/useSettingsQueries', () => ({
  useSettingsForChatQuery: () => ({ data: undefined }),
}));
vi.mock('@/contexts/ChatContext', () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/chat/chat-window/ChatSessionOrchestrator', () => ({
  ChatSessionOrchestrator: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/chat/chat-window/Chat', () => ({ Chat: () => null }));
vi.mock('@/components/chat/session-panel/SessionPanel', () => ({ SessionPanel: () => null }));
vi.mock('@/components/layout/WorkspaceSurface/WorkspaceSurface', () => ({
  WorkspaceSurface: () => null,
  WorkspaceTile: () => null,
}));

let navigate: NavigateFunction = () => {};

function CaptureNavigate() {
  navigate = useNavigate();
  return null;
}

describe('ChatPage split panes', () => {
  beforeEach(() => {
    useUIStore.setState({
      openTabs: ['agent:primary'],
      visibleLayout: [['agent:primary']],
      splitChatIds: [],
      layoutsByChat: {},
      currentWorkspaceChatId: null,
      chatTabs: [],
    });
  });

  afterEach(() => {
    useUIStore.getState().resetWorkspace();
  });

  it('promotes the first split when the primary pane closes, keeping the rest in order', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/chat/primary-chat']}>
          <CaptureNavigate />
          <Routes>
            <Route path="/chat/:chatId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    act(() => {
      useUIStore.getState().openChatInSplit('split-a');
      useUIStore.getState().openChatInSplit('split-b');
      useUIStore.getState().openChatInSplit('split-c');
    });

    act(() => navigate('/chat/split-a'));

    const ui = useUIStore.getState();
    expect(ui.currentWorkspaceChatId).toBe('split-a');
    expect(ui.splitChatIds).toEqual(['split-b', 'split-c']);
    expect(ui.visibleLayout).toEqual([['agent:primary', 'agent:split-1', 'agent:split-2']]);
  });
});
