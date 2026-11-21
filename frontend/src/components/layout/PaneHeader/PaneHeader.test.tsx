// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUIStore } from '@/store/uiStore';
import { SidebarOverlays } from '@/components/layout/Sidebar/SidebarOverlays';
import { useSidebarChatActions } from '@/components/layout/Sidebar/useSidebarChatActions';
import { useSidebarWorkspaceActions } from '@/components/layout/Sidebar/useSidebarWorkspaceActions';
import type { Chat } from '@/types/chat.types';
import { PaneHeaderBand } from './PaneHeader';

const CHATS: Record<string, Chat> = {
  'primary-chat': {
    id: 'primary-chat',
    title: 'Primary chat',
    parent_chat_id: null,
    channel_id: null,
    pinned_at: null,
    workspace_id: 'ws-1',
  } as Chat,
  'split-chat': {
    id: 'split-chat',
    title: 'Split chat',
    parent_chat_id: null,
    channel_id: null,
    pinned_at: null,
    workspace_id: 'ws-1',
  } as Chat,
};

const { deleteChat, mutation } = vi.hoisted(() => ({
  deleteChat: vi.fn(() => Promise.resolve()),
  mutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/queries/useModelQueries', () => ({ useModelMap: () => new Map() }));
vi.mock('@/hooks/queries/useChatQueries', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useChatQuery: (chatId: string) => ({ data: CHATS[chatId] }),
  useDeleteChatMutation: () => ({ mutateAsync: deleteChat, isPending: false }),
  useForkChatMutation: mutation,
  useGenerateChatTitleMutation: mutation,
  useUpdateChatMutation: mutation,
  usePinChatMutation: mutation,
  usePromoteChatMutation: mutation,
}));
vi.mock('@/hooks/queries/useWorkspaceQueries', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDeleteWorkspaceMutation: mutation,
  useUpdateWorkspaceMutation: mutation,
}));
vi.mock('@/hooks/queries/useMachineQueries', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMachineUpdateWorkspaceMutation: mutation,
  useMachineDeleteWorkspaceMutation: mutation,
}));

let pathname = '';

function SidebarMenuHost() {
  const navigate = useNavigate();
  pathname = useLocation().pathname;
  const scrollContainerRef = { current: null };
  const chat = useSidebarChatActions({
    selectedChatId: 'primary-chat',
    isMobile: false,
    navigate,
    scrollContainerRef,
    onChatSelect: () => {},
  });
  const workspace = useSidebarWorkspaceActions({
    selectedChatId: 'primary-chat',
    selectedChannelId: null,
    isMobile: false,
    navigate,
    workspaceBadgeById: new Map(),
    chats: [],
    scrollContainerRef,
  });
  return (
    <SidebarOverlays chat={chat} workspace={workspace} workspaces={[]} machineWorkspaces={{}} />
  );
}

function renderHeaders() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/chat/primary-chat']}>
        <PaneHeaderBand routedChatId="primary-chat" leading={null} />
        <SidebarMenuHost />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openSplit() {
  act(() => useUIStore.getState().openChatInSplit('split-chat'));
}

describe('PaneHeaderBand', () => {
  beforeEach(() => {
    useUIStore.getState().resetWorkspace();
    useUIStore.setState({ chatMenu: null });
  });

  afterEach(() => {
    deleteChat.mockClear();
  });

  it("lists the sidebar's chat menu without Open in split, and closes only with two panes", () => {
    renderHeaders();
    expect(screen.queryByRole('button', { name: 'Close pane' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    const items = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items).toEqual(['Pin', 'Workspace', 'Rename', 'Copy chat ID', 'Delete']);

    openSplit();
    expect(screen.getAllByRole('button', { name: 'Close pane' })).toHaveLength(2);
  });

  it("deletes a split pane's chat from its header without leaving the routed chat", async () => {
    renderHeaders();
    openSplit();

    fireEvent.click(screen.getAllByRole('button', { name: 'Chat menu' })[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(deleteChat).toHaveBeenCalledWith('split-chat');
    expect(useUIStore.getState().splitChatIds).toEqual([]);
    expect(useUIStore.getState().visibleLayout).toEqual([['agent:primary']]);
    expect(pathname).toBe('/chat/primary-chat');
  });
});
