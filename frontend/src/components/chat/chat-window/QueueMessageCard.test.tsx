// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueMessageCard } from './QueueMessageCard';
import type { LocalQueuedMessage } from '@/types/queue.types';

function makeMessage(over: Partial<LocalQueuedMessage> = {}): LocalQueuedMessage {
  return {
    id: 'msg-1',
    content: 'queued text',
    model_id: 'claude-x',
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

  it('renders the queued message content', () => {
    renderCard({ content: 'deploy the app' });
    expect(screen.getByText('deploy the app')).toBeTruthy();
  });

  it('cancels the queued message when the cancel action is clicked', () => {
    const { onCancel } = renderCard();
    fireEvent.click(screen.getByLabelText('Cancel message'));
    expect(onCancel).toHaveBeenCalledWith('msg-1');
  });

  it('sends now only for a synced message and dispatches the id', () => {
    const { onSendNow } = renderCard({ synced: true });
    fireEvent.click(screen.getByLabelText('Send now'));
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
    fireEvent.click(screen.getByLabelText('Edit message'));

    const input = screen.getByLabelText('Edit message') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  new text  ' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onEdit).toHaveBeenCalledWith('msg-1', 'new text');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels rather than persisting an empty edit — a blank message must never be queued', () => {
    const { onEdit, onCancel } = renderCard({ content: 'old' });
    fireEvent.click(screen.getByLabelText('Edit message'));

    const input = screen.getByLabelText('Edit message') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onCancel).toHaveBeenCalledWith('msg-1');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('saves an edit on Enter and abandons it on Escape', () => {
    const { onEdit } = renderCard({ content: 'first' });

    // Enter commits.
    fireEvent.click(screen.getByLabelText('Edit message'));
    let input = screen.getByLabelText('Edit message') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'committed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('msg-1', 'committed');

    // Escape discards: the original preview is restored and no further edit fires.
    onEdit.mockReset();
    fireEvent.click(screen.getByLabelText('Edit message'));
    input = screen.getByLabelText('Edit message') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('first')).toBeTruthy();
  });
});
