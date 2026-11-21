// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatService } from '@/services/chatService';
import type { Chat } from '@/types/chat.types';
import { ForkOriginBadge } from './ForkOriginBadge';

function renderBadge() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ForkOriginBadge
          sourceChatId="source-1"
          sourceMessageId="message-1"
          sourceTitle="Retry and backoff"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ForkOriginBadge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers to open a source chat that still exists', async () => {
    vi.spyOn(chatService, 'getChat').mockResolvedValue({ title: 'Retry and backoff' } as Chat);
    renderBadge();

    expect(screen.getByText('“Retry and backoff”')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Show' })).toBeTruthy();
  });

  it('keeps the title without the link once the source is deleted', async () => {
    const getChat = vi.spyOn(chatService, 'getChat').mockRejectedValue(new Error('Not found'));
    renderBadge();

    await vi.waitFor(() => expect(getChat).toHaveBeenCalled());
    expect(screen.getByText('“Retry and backoff”')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
  });
});
