// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDropdown } from './ChatDropdown';
import { useStreamStore } from '@/store/streamStore';
import type { Chat } from '@/types/chat.types';

const subThread = {
  id: 'sub-1',
  title: 'Sub-thread',
  parent_chat_id: 'parent-1',
  channel_id: null,
  pinned_at: null,
  session_agent_kind: 'claude',
  last_model_id: 'sonnet',
} as Chat;

function renderDropdown() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatDropdown
        chat={subThread}
        position={{ top: 0, left: 0 }}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
        onFork={vi.fn()}
        forkPending={false}
        onConvertToThread={vi.fn()}
        convertPending={false}
        onWorkspaceOptions={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return screen.getByRole('menuitem', { name: 'Convert to thread' }) as HTMLButtonElement;
}

describe('ChatDropdown "Convert to thread"', () => {
  beforeEach(() => useStreamStore.setState({ activeStreamMetadata: [] }));

  it('is offered for a sub-thread', () => {
    expect(renderDropdown().disabled).toBe(false);
  });

  it('is disabled while the sub-thread is running', () => {
    useStreamStore.setState({
      activeStreamMetadata: [{ chatId: 'sub-1', messageId: 'm-1', startTime: 0 }],
    });
    expect(renderDropdown().disabled).toBe(true);
  });
});

describe('ChatDropdown "Copy chat ID"', () => {
  it('writes the chat id to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    renderDropdown();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy chat ID' }));
    expect(writeText).toHaveBeenCalledWith('sub-1');
    vi.unstubAllGlobals();
  });
});
