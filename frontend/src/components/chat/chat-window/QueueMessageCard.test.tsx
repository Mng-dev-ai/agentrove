// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueMessageCard } from './QueueMessageCard';
import type { LocalQueuedMessage } from '@/types/queue.types';

function makeMessage(over: Partial<LocalQueuedMessage> = {}): LocalQueuedMessage {
  return {
    id: 'msg-1',
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
    <QueueMessageCard
      message={makeMessage(over)}
      onCancel={onCancel}
      onEdit={onEdit}
      onSendNow={onSendNow}
    />,
  );
  return { onCancel, onEdit, onSendNow };
}

describe('QueueMessageCard', () => {
  afterEach(cleanup);

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

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Edit message' });
    fireEvent.change(input, { target: { value: '  new text  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onEdit).toHaveBeenCalledWith('msg-1', 'new text');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels the message instead of saving a blank edit', () => {
    const { onEdit, onCancel } = renderCard({ content: 'old' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Edit message' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCancel).toHaveBeenCalledWith('msg-1');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('saves an edit on Enter and abandons it on Escape', () => {
    const { onEdit } = renderCard({ content: 'first' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    let input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Edit message' });
    fireEvent.change(input, { target: { value: 'committed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('msg-1', 'committed');

    onEdit.mockReset();
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Edit message' });
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('first')).toBeTruthy();
  });
});
