// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarInbox } from './SidebarInbox';

const useInboxQuery = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/queries/useInboxQueries', () => ({ useInboxQuery }));

function renderInbox() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<SidebarInbox />} />
        <Route path="/inbox" element={<div>inbox page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SidebarInbox', () => {
  afterEach(cleanup);

  it('shows the unread count badge when there are unread items', () => {
    useInboxQuery.mockReturnValue({ data: { items: [], unread_count: 3 } });
    renderInbox();
    expect(screen.getByLabelText('3 unread').textContent).toBe('3');
  });

  it('hides the badge when nothing is unread', () => {
    useInboxQuery.mockReturnValue({ data: { items: [], unread_count: 0 } });
    renderInbox();
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it('navigates to /inbox when the row is clicked', () => {
    useInboxQuery.mockReturnValue({ data: { items: [], unread_count: 1 } });
    renderInbox();
    fireEvent.click(screen.getByText('Messages'));
    expect(screen.getByText('inbox page')).toBeTruthy();
  });
});
