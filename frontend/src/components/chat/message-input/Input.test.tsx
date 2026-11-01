// @vitest-environment jsdom

import { useState, type FormEvent } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from './Input';
import { ChatProvider } from '@/contexts/ChatContext';
import { queryClient } from '@/lib/queryClient';
import { queueService } from '@/services/queueService';
import { useAuthStore } from '@/store/authStore';
import { useMessageQueueStore } from '@/store/messageQueueStore';

vi.mock('@/services/queueService', () => ({
  queueService: {
    queueMessage: vi.fn(() => Promise.resolve({ id: 'queued-id', send_now_failed: false })),
  },
}));
vi.mock('@/services/settingsService', () => ({
  settingsService: { getSettings: () => Promise.resolve({ auto_steer_queued_messages: false }) },
}));
vi.mock('@/services/chatService', () => ({
  chatService: { getChat: () => new Promise(() => {}) },
}));

vi.mock('./InputControls', () => ({ InputControls: () => null }));

function Composer({
  isStreaming,
  selectedModelId = 'claude-x',
  onSubmit,
}: {
  isStreaming: boolean;
  selectedModelId?: string;
  onSubmit: (e: FormEvent) => void;
}) {
  const [message, setMessage] = useState('');
  return (
    <QueryClientProvider client={queryClient}>
      <ChatProvider chatId="chat-1">
        <Input
          message={message}
          setMessage={setMessage}
          onSubmit={onSubmit}
          isLoading={false}
          isStreaming={isStreaming}
          selectedModelId={selectedModelId}
          onModelChange={vi.fn()}
          chatId="chat-1"
        />
      </ChatProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

function renderComposer(props: { isStreaming: boolean; selectedModelId?: string }) {
  const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
  render(<Composer {...props} onSubmit={onSubmit} />);
  const textbox = screen.getByLabelText<HTMLTextAreaElement>('Message input');
  const send = (text: string) => {
    fireEvent.change(textbox, { target: { value: text } });
    fireEvent.keyDown(textbox, { key: 'Enter' });
  };
  return { onSubmit, textbox, send };
}

describe('Input send/queue path', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    useAuthStore.setState({ isAuthenticated: false });
    useMessageQueueStore.setState({ queues: new Map() });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    queryClient.clear();
    vi.mocked(queueService.queueMessage).mockClear();
  });

  it('submits the message on Enter when the agent is idle', () => {
    const { onSubmit, send } = renderComposer({ isStreaming: false });
    send('hello world');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(queueService.queueMessage).not.toHaveBeenCalled();
  });

  it('queues the message and clears the draft while a response is streaming', async () => {
    const { onSubmit, textbox, send } = renderComposer({ isStreaming: true });
    send('hello world');

    expect(textbox.value).toBe('');
    await waitFor(() =>
      expect(useMessageQueueStore.getState().getQueue('chat-1')).toEqual([
        expect.objectContaining({ id: 'queued-id', content: 'hello world', synced: true }),
      ]),
    );
    expect(queueService.queueMessage).toHaveBeenCalledWith(
      'chat-1',
      'hello world',
      'claude-x',
      expect.anything(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the draft and shows an error instead of queuing when no model is selected', async () => {
    const { onSubmit, textbox, send } = renderComposer({ isStreaming: true, selectedModelId: '' });
    send('hello world');

    expect(await screen.findByText('Please select an AI model')).toBeTruthy();
    expect(textbox.value).toBe('hello world');
    expect(queueService.queueMessage).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit or queue an empty draft', () => {
    const { onSubmit, send } = renderComposer({ isStreaming: false });
    send('   ');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(queueService.queueMessage).not.toHaveBeenCalled();
  });
});
