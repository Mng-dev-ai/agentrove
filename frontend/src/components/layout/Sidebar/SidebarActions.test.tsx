// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarActions } from './SidebarActions';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { inboxService } from '@/services/inboxService';
import { useAuthStore } from '@/store/authStore';

vi.mock('@/services/inboxService', () => ({ inboxService: { listInbox: vi.fn() } }));

async function renderActions(unreadCount: number) {
  vi.mocked(inboxService.listInbox).mockResolvedValue({
    items: [],
    next_cursor: null,
    has_more: false,
    unread_count: unreadCount,
  });
  const onOpenInbox = vi.fn();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <SidebarActions onNewChat={vi.fn()} onOpenSearch={vi.fn()} onOpenInbox={onOpenInbox} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.getQueryState(queryKeys.inbox)?.status).toBe('success'));
  return { onOpenInbox };
}

describe('SidebarActions inbox row', () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: true }));

  it.each([
    [3, '3'],
    [120, '99+'],
  ])('shows %i unread as a "%s" badge', async (count, badge) => {
    await renderActions(count);
    expect(screen.getByLabelText(`${count} unread`).textContent).toBe(badge);
  });

  it('hides the badge when nothing is unread', async () => {
    await renderActions(0);
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it('opens the inbox when the row is clicked', async () => {
    const { onOpenInbox } = await renderActions(1);
    fireEvent.click(screen.getByRole('button', { name: /^Inbox/ }));
    expect(onOpenInbox).toHaveBeenCalledOnce();
  });
});
