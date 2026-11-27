// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TitleBarActions } from './TitleBarActions';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { inboxService } from '@/services/inboxService';
import { useAuthStore } from '@/store/authStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';

vi.mock('@/services/inboxService', () => ({ inboxService: { listInbox: vi.fn() } }));

async function renderActions(unreadCount: number) {
  vi.mocked(inboxService.listInbox).mockResolvedValue({
    items: [],
    next_cursor: null,
    has_more: false,
    unread_count: unreadCount,
  });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TitleBarActions />
        <Routes>
          <Route path="/" element={null} />
          <Route path="/inbox" element={<p>Inbox page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(client.getQueryState(queryKeys.machine.inbox(LOCAL_MACHINE_ID))?.status).toBe('success'),
  );
}

describe('TitleBarActions inbox button', () => {
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

  it('opens the inbox when clicked', async () => {
    await renderActions(1);
    fireEvent.click(screen.getByRole('button', { name: /^Inbox/ }));
    expect(screen.getByText('Inbox page')).toBeTruthy();
  });
});
