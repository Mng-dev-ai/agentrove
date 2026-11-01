// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ElicitationInline } from './ElicitationInline';
import type { ElicitationRequest } from '@/types/chat.types';

function makeRequest(requestId: string): ElicitationRequest {
  return {
    request_id: requestId,
    message: 'Which framework?',
    tool_call_id: null,
    requested_schema: {
      type: 'object',
      properties: { notes: { type: 'string', title: 'Notes' } },
    },
  };
}

const noop = () => {};

function form(requestId: string) {
  return (
    <ElicitationInline
      request={makeRequest(requestId)}
      onSubmit={noop}
      onSkip={noop}
      onCancel={noop}
    />
  );
}

const notesField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Notes' });

afterEach(cleanup);

describe('ElicitationInline', () => {
  it('keeps typed answers when hydration re-delivers the same form', () => {
    const { rerender } = render(form('elicit-1'));
    fireEvent.change(notesField(), { target: { value: 'half typed' } });

    // Reconciliation hands back an equal-but-distinct object for the same id.
    rerender(form('elicit-1'));

    expect(notesField().value).toBe('half typed');
  });

  it('clears typed answers when the queue advances to the next form', () => {
    const { rerender } = render(form('elicit-1'));
    fireEvent.change(notesField(), { target: { value: 'half typed' } });

    rerender(form('elicit-2'));

    expect(notesField().value).toBe('');
  });
});
