// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarActions } from './SidebarActions';

const useInboxQuery = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/queries/useInboxQueries', () => ({ useInboxQuery }));

function renderActions(unreadCount: number) {
  useInboxQuery.mockReturnValue({
    data: { pages: [{ items: [], next_cursor: null, has_more: false, unread_count: unreadCount }] },
  });
  const onOpenInbox = vi.fn();
  render(<SidebarActions onNewChat={vi.fn()} onOpenSearch={vi.fn()} onOpenInbox={onOpenInbox} />);
  return { onOpenInbox };
}

describe('SidebarActions inbox row', () => {
  afterEach(cleanup);

  it('shows the unread count badge when there are unread items', () => {
    renderActions(3);
    expect(screen.getByLabelText('3 unread').textContent).toBe('3');
  });

  it('caps the badge at 99+', () => {
    renderActions(120);
    expect(screen.getByLabelText('120 unread').textContent).toBe('99+');
  });

  it('hides the badge when nothing is unread', () => {
    renderActions(0);
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it('opens the inbox when the row is clicked', () => {
    const { onOpenInbox } = renderActions(1);
    fireEvent.click(screen.getByText('Inbox'));
    expect(onOpenInbox).toHaveBeenCalledOnce();
  });
});
