// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatQueueBanner } from './ChatQueueBanner';
import { QueueMessageCard } from './QueueMessageCard';
import { SetChatInputMessageContext } from '@/contexts/ChatInputMessageContextDefinition';
import type { LocalQueuedMessage } from '@/types/queue.types';

function makeMessage(over: Partial<LocalQueuedMessage> = {}): LocalQueuedMessage {
  const id = over.id ?? 'msg-1';
  return {
    id,
    key: id,
    content: 'queued text',
    queuedAt: 0,
    synced: true,
    sendingNow: false,
    ...over,
  };
}

function renderCard(over: Partial<LocalQueuedMessage> = {}) {
  const onCancel = vi.fn();
  const onEdit = vi.fn();
  const onSendNow = vi.fn();
  render(
    <SetChatInputMessageContext.Provider value={vi.fn()}>
      <QueueMessageCard
        message={makeMessage(over)}
        onCancel={onCancel}
        onEdit={onEdit}
        onSendNow={onSendNow}
        rescued={false}
        onDirtyChange={vi.fn()}
        onDiscard={vi.fn()}
      />
    </SetChatInputMessageContext.Provider>,
  );
  return { onCancel, onEdit, onSendNow };
}

function renderBanner(messages: LocalQueuedMessage[]) {
  const banner = (queue: LocalQueuedMessage[]) => (
    <SetChatInputMessageContext.Provider value={vi.fn()}>
      <ChatQueueBanner messages={queue} onCancel={vi.fn()} onEdit={vi.fn()} onSendNow={vi.fn()} />
    </SetChatInputMessageContext.Provider>
  );
  const { container, rerender } = render(banner(messages));
  return { container, setQueue: (queue: LocalQueuedMessage[]) => rerender(banner(queue)) };
}

function editFirst(value: string) {
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit message' })[0]);
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit message' });
  fireEvent.change(input, { target: { value } });
  return input;
}

describe('QueueMessageCard', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancels the queued message when the cancel action is clicked', () => {
    const { onCancel } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel message' }));
    expect(onCancel).toHaveBeenCalledWith('msg-1');
  });

  it('sends a synced message now', () => {
    const { onSendNow } = renderCard({ synced: true });
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    expect(onSendNow).toHaveBeenCalledWith('msg-1');
  });

  it('hides the send-now action for an unsynced (still uploading) message', () => {
    renderCard({ synced: false });
    expect(screen.queryByLabelText('Send now')).toBeNull();
  });

  it('shows a sending state instead of actions while dispatching', () => {
    renderCard({ sendingNow: true });
    expect(screen.getByText('Sending...')).toBeTruthy();
    expect(screen.queryByLabelText('Cancel message')).toBeNull();
    expect(screen.queryByLabelText('Edit message')).toBeNull();
  });

  it('persists an edited message via onEdit with trimmed content', () => {
    const { onEdit, onCancel } = renderCard({ content: 'old' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));

    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit message' });
    fireEvent.change(input, { target: { value: '  new text  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onEdit).toHaveBeenCalledWith('msg-1', 'new text');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels the message instead of saving a blank edit', () => {
    const { onEdit, onCancel } = renderCard({ content: 'old' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));

    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit message' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCancel).toHaveBeenCalledWith('msg-1');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('saves an edit on Enter and abandons it on Escape', () => {
    const { onEdit } = renderCard({ content: 'first' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    let input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit message' });
    fireEvent.change(input, { target: { value: 'committed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('msg-1', 'committed');

    onEdit.mockReset();
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit message' });
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('first')).toBeTruthy();
  });

  it('keeps newlines when a multi-line edit is saved with Enter after Shift+Enter', () => {
    const { onEdit } = renderCard({ content: 'line one\nline two' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit message' });
    expect(textarea.value).toBe('line one\nline two');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: 'line one\nline two\n\nline four' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('msg-1', 'line one\nline two\n\nline four');
  });
});

describe('ChatQueueBanner', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a changed draft on screen when its row leaves the queue', () => {
    const { setQueue } = renderBanner([makeMessage({ content: 'old' })]);
    const input = editFirst('my new draft');

    setQueue([]);

    expect(screen.getByRole('textbox', { name: 'Edit message' })).toBe(input);
    expect(input.value).toBe('my new draft');
    expect(screen.getByText('Original already sent. Edit not saved.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('drops an unchanged draft and a non-editing row when they leave the queue', () => {
    const { container, setQueue } = renderBanner([
      makeMessage({ id: 'a', content: 'first' }),
      makeMessage({ id: 'b', content: 'second' }),
    ]);
    editFirst('first');

    setQueue([]);

    expect(container.innerHTML).toBe('');
  });
});
