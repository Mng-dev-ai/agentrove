// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInlineElicitation } from './ChatInlineElicitation';
import {
  ChatSessionActionsContext,
  ChatSessionStateContext,
  type ChatSessionActions,
  type ChatSessionState,
} from '@/contexts/ChatSessionContextDefinition';
import type { ElicitationRequest, PermissionRequest } from '@/types/chat.types';

function makeRequest(): ElicitationRequest {
  return {
    request_id: 'req-1',
    message: 'Which framework?',
    tool_call_id: null,
    requested_schema: {
      type: 'object',
      properties: {
        framework: {
          type: 'string',
          title: 'Framework',
          oneOf: [
            { const: 'react', title: 'React' },
            { const: 'vue', title: 'Vue' },
          ],
        },
        notes: { type: 'string', title: 'Notes' },
      },
    },
  };
}

function renderWithSession(state: Partial<ChatSessionState>) {
  const actions = {
    onElicitationSubmit: vi.fn(),
    onElicitationSkip: vi.fn(),
    onElicitationCancel: vi.fn(),
  } as Partial<ChatSessionActions> as ChatSessionActions;
  const { container } = render(
    <ChatSessionStateContext
      value={
        {
          pendingElicitationRequest: null,
          pendingPermissionRequest: null,
          isElicitationLoading: false,
          elicitationError: null,
          ...state,
        } as ChatSessionState
      }
    >
      <ChatSessionActionsContext value={actions}>
        <ChatInlineElicitation />
      </ChatSessionActionsContext>
    </ChatSessionStateContext>,
  );
  return { container, actions };
}

describe('ChatInlineElicitation', () => {
  afterEach(cleanup);

  it('renders nothing when there is no pending elicitation', () => {
    const { container } = renderWithSession({});
    expect(container.firstChild).toBeNull();
  });

  it('yields the slot to a pending permission request', () => {
    const permission: PermissionRequest = {
      request_id: 'perm-1',
      tool_name: 'Bash',
      tool_input: {},
      options: [],
      seq: 1,
    };
    const { container } = renderWithSession({
      pendingElicitationRequest: makeRequest(),
      pendingPermissionRequest: permission,
    });
    expect(container.firstChild).toBeNull();
  });

  it('submits only the fields the user filled in', () => {
    const { actions } = renderWithSession({ pendingElicitationRequest: makeRequest() });

    fireEvent.click(screen.getByLabelText('Vue'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(actions.onElicitationSubmit).toHaveBeenCalledExactlyOnceWith({ framework: 'vue' });
  });

  it('skips on the Skip button and on Escape', () => {
    const { actions } = renderWithSession({ pendingElicitationRequest: makeRequest() });

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Escape' });

    expect(actions.onElicitationSkip).toHaveBeenCalledTimes(2);
    expect(actions.onElicitationCancel).not.toHaveBeenCalled();
  });

  it('cancels the tool call from the dismiss button', () => {
    const { actions } = renderWithSession({ pendingElicitationRequest: makeRequest() });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel this tool call' }));

    expect(actions.onElicitationCancel).toHaveBeenCalledOnce();
    expect(actions.onElicitationSkip).not.toHaveBeenCalled();
  });

  it('shows the error and keeps the form submittable for a retry', () => {
    const { actions } = renderWithSession({
      pendingElicitationRequest: makeRequest(),
      elicitationError: 'Network unreachable',
    });

    expect(screen.getByText('Network unreachable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(actions.onElicitationSubmit).toHaveBeenCalledOnce();
  });
});
