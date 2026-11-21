// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUIStore } from '@/store/uiStore';
import type { TileId } from '@/types/ui.types';
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
vi.mock('@/components/chat/chat-window/Chat', () => ({
  Chat: ({ corner }: { corner?: ReactNode }) => <div data-testid="chat-pane">{corner}</div>,
}));
vi.mock('@/components/chat/session-panel/SessionPanel', () => ({ SessionPanel: () => null }));
vi.mock('@/components/layout/WorkspaceSurface/WorkspaceSurface', () => ({
  WorkspaceSurface: ({
    renderView,
  }: {
    renderView: (tileId: TileId, isVisible: boolean) => ReactNode;
  }) => (
    <>
      {(['agent:primary', 'agent:split-1'] as const).map((tileId) => (
        <div key={tileId} data-testid={tileId}>
          {renderView(tileId, true)}
        </div>
      ))}
    </>
  ),
  WorkspaceTile: ({ agent }: { agent: ReactNode }) => agent,
}));

describe('ChatPage split panes', () => {
  const closeSplitChat = vi.fn();

  beforeEach(() => {
    useUIStore.setState({ splitChatIds: ['split-chat'], closeSplitChat });
  });

  afterEach(() => {
    closeSplitChat.mockReset();
  });

  it('gives only the split pane a close button that closes that split', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/chat/primary-chat']}>
          <Routes>
            <Route path="/chat/:chatId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      within(screen.getByTestId('agent:primary')).queryByRole('button', { name: 'Close split' }),
    ).toBeNull();

    fireEvent.click(
      within(screen.getByTestId('agent:split-1')).getByRole('button', { name: 'Close split' }),
    );

    expect(closeSplitChat).toHaveBeenCalledWith('split-chat');
  });
});
