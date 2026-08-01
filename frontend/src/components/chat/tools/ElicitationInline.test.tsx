// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElicitationInline } from './ElicitationInline';
import type { ElicitationRequest } from '@/types/chat.types';

function makeRequest(over: Partial<ElicitationRequest> = {}): ElicitationRequest {
  return {
    request_id: 'elicit-1',
    message: 'Which framework?',
    tool_call_id: null,
    requested_schema: {
      type: 'object',
      properties: { notes: { type: 'string', title: 'Notes' } },
    },
    ...over,
  };
}

const noop = vi.fn();

afterEach(() => {
  cleanup();
  noop.mockReset();
});

describe('ElicitationInline', () => {
  it('keeps typed answers when hydration re-delivers the same form', () => {
    const { rerender } = render(
      <ElicitationInline request={makeRequest()} onSubmit={noop} onSkip={noop} onCancel={noop} />,
    );

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'half typed' } });
    // Reconciliation hands back an equal-but-distinct object for the same id.
    rerender(
      <ElicitationInline request={makeRequest()} onSubmit={noop} onSkip={noop} onCancel={noop} />,
    );

    expect((screen.getByLabelText('Notes') as HTMLInputElement).value).toBe('half typed');
  });

  it('clears typed answers when the queue advances to the next form', () => {
    const { rerender } = render(
      <ElicitationInline request={makeRequest()} onSubmit={noop} onSkip={noop} onCancel={noop} />,
    );

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'half typed' } });
    rerender(
      <ElicitationInline
        request={makeRequest({ request_id: 'elicit-2' })}
        onSubmit={noop}
        onSkip={noop}
        onCancel={noop}
      />,
    );

    expect((screen.getByLabelText('Notes') as HTMLInputElement).value).toBe('');
  });
});
