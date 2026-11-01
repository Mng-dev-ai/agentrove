// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessageRenderer } from './MessageRenderer';
import { chatService } from '@/services/chatService';
import type { AssistantStreamEvent } from '@/types/chat.types';
import type { ToolEventPayload } from '@/types/tools.types';

// SegmentView pulls in markdown, the tool registry and the smooth-text
// animation; a stub exposes the per-segment active flags MessageRenderer sets.
vi.mock('./SegmentView', () => ({
  SegmentView: ({
    segment,
    isActiveThinking,
    isActiveText,
  }: {
    segment: { id: string; kind: string; text?: string };
    isActiveThinking: boolean;
    isActiveText: boolean;
  }) => (
    <div
      data-testid="segment"
      data-id={segment.id}
      data-kind={segment.kind}
      data-active-thinking={String(isActiveThinking)}
      data-active-text={String(isActiveText)}
    >
      {segment.text ?? ''}
    </div>
  ),
}));

vi.mock('@/services/chatService', () => ({
  chatService: { getMessageRender: vi.fn() },
}));

const tool = (over: Partial<ToolEventPayload> & { id: string }): ToolEventPayload => ({
  name: 'Bash',
  title: 'run',
  status: 'started',
  ...over,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

function renderedOrder() {
  return screen.getAllByTestId('segment').map((el) => el.getAttribute('data-id'));
}

describe('MessageRenderer streaming wiring', () => {
  afterEach(cleanup);

  it('marks only the trailing text segment active while its text streams in', () => {
    const events: AssistantStreamEvent[] = [
      { type: 'assistant_text', text: 'first' },
      { type: 'tool_started', tool: tool({ id: 't1' }) },
      { type: 'assistant_text', text: 'live tail' },
    ];
    render(<MessageRenderer events={events} isStreaming />, { wrapper });

    const segments = screen.getAllByTestId('segment');
    const byId = Object.fromEntries(segments.map((el) => [el.getAttribute('data-id'), el]));
    expect(byId['text-1'].getAttribute('data-active-text')).toBe('true');
    expect(byId['text-0'].getAttribute('data-active-text')).toBe('false');
    expect(byId['tool-t1'].getAttribute('data-active-thinking')).toBe('false');
  });

  it('marks the trailing thinking segment active while thinking streams', () => {
    render(
      <MessageRenderer
        events={[{ type: 'assistant_thinking', thinking: 'pondering' }]}
        isStreaming
      />,
      { wrapper },
    );
    const segment = screen.getByTestId('segment');
    expect(segment.getAttribute('data-kind')).toBe('thinking');
    expect(segment.getAttribute('data-active-thinking')).toBe('true');
  });

  it('never marks a segment active once the turn is no longer streaming', () => {
    const events: AssistantStreamEvent[] = [
      { type: 'assistant_text', text: 'partial' },
      { type: 'assistant_thinking', thinking: 'cut off mid-thought' },
    ];
    render(<MessageRenderer events={events} isStreaming={false} />, { wrapper });
    expect(renderedOrder()).toEqual(['text-0', 'thinking-0']);
    for (const el of screen.getAllByTestId('segment')) {
      expect(el.getAttribute('data-active-thinking')).toBe('false');
      expect(el.getAttribute('data-active-text')).toBe('false');
    }
  });

  it('collapses the completed work trace behind the Worked toggle and leads with the answer', () => {
    const events: AssistantStreamEvent[] = [
      { type: 'assistant_thinking', thinking: 'plan' },
      { type: 'tool_started', tool: tool({ id: 't1' }) },
      { type: 'tool_completed', tool: tool({ id: 't1', status: 'completed' }) },
      { type: 'assistant_text', text: 'the answer' },
    ];
    render(<MessageRenderer events={events} isStreaming={false} durationMs={65_000} />, {
      wrapper,
    });

    expect(renderedOrder()).toEqual(['text-0']);

    fireEvent.click(screen.getByRole('button', { name: /^Worked for/ }));
    expect(renderedOrder()).toEqual(['thinking-0', 'tool-t1', 'text-0']);
  });

  it('keeps live segments flat while streaming', () => {
    const events: AssistantStreamEvent[] = [
      { type: 'assistant_thinking', thinking: 'plan' },
      { type: 'tool_started', tool: tool({ id: 't1' }) },
      { type: 'assistant_text', text: 'streaming answer' },
    ];
    render(<MessageRenderer events={events} isStreaming />, { wrapper });
    expect(screen.queryByRole('button', { name: /^Worked/ })).toBeNull();
    expect(renderedOrder()).toEqual(['thinking-0', 'tool-t1', 'text-0']);
  });

  it('loads omitted tool results on expand and recovers from a failed load via Retry', async () => {
    const getMessageRender = vi.mocked(chatService.getMessageRender);
    const slim: AssistantStreamEvent[] = [
      { type: 'tool_completed', tool: tool({ id: 't1', status: 'completed' }) },
      { type: 'assistant_text', text: 'the answer' },
    ];
    const full: AssistantStreamEvent[] = [
      { type: 'tool_completed', tool: tool({ id: 't1', status: 'completed', result: 'out' }) },
      { type: 'assistant_text', text: 'the answer' },
    ];
    getMessageRender
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ events: full });
    render(
      <MessageRenderer
        events={slim}
        isStreaming={false}
        omittedToolResults={{ chatId: 'c1', messageId: 'm1' }}
      />,
      { wrapper },
    );

    expect(renderedOrder()).toEqual(['text-0']);
    expect(getMessageRender).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Worked' }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(renderedOrder()).toEqual(['text-0']);

    fireEvent.click(retry);
    await waitFor(() => expect(renderedOrder()).toEqual(['tool-t1', 'text-0']));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(getMessageRender).toHaveBeenCalledTimes(2);
    expect(getMessageRender).toHaveBeenCalledWith('c1', 'm1');
  });
});
