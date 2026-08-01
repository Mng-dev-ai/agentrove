// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInlineElicitation } from './ChatInlineElicitation';
import type { ElicitationRequest, PermissionRequest } from '@/types/chat.types';

const hooks = vi.hoisted(() => ({
  state: {
    pendingElicitationRequest: null as ElicitationRequest | null,
    pendingPermissionRequest: null as PermissionRequest | null,
    isElicitationLoading: false,
    elicitationError: null as string | null,
  },
  actions: {
    onElicitationSubmit: vi.fn(),
    onElicitationSkip: vi.fn(),
    onElicitationCancel: vi.fn(),
  },
}));

// The component reads the live request and the answer actions straight off the
// chat-session context; mock at that boundary so the test drives the same wiring
// the real provider supplies.
vi.mock('@/hooks/useChatSessionContext', () => ({
  useChatSessionState: () => hooks.state,
  useChatSessionActions: () => hooks.actions,
}));

function makeRequest(over: Partial<ElicitationRequest> = {}): ElicitationRequest {
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
    ...over,
  };
}

describe('ChatInlineElicitation', () => {
  afterEach(() => {
    cleanup();
    hooks.state.pendingElicitationRequest = null;
    hooks.state.pendingPermissionRequest = null;
    hooks.state.isElicitationLoading = false;
    hooks.state.elicitationError = null;
    hooks.actions.onElicitationSubmit.mockReset();
    hooks.actions.onElicitationSkip.mockReset();
    hooks.actions.onElicitationCancel.mockReset();
  });

  it('renders nothing when there is no pending elicitation', () => {
    const { container } = render(<ChatInlineElicitation />);
    expect(container.firstChild).toBeNull();
  });

  it('yields the slot to a pending permission request', () => {
    hooks.state.pendingElicitationRequest = makeRequest();
    hooks.state.pendingPermissionRequest = {
      request_id: 'perm-1',
      tool_name: 'Bash',
      tool_input: {},
      options: [],
      seq: 1,
    };

    const { container } = render(<ChatInlineElicitation />);
    expect(container.firstChild).toBeNull();
  });

  it('submits only the fields the user filled in', () => {
    hooks.state.pendingElicitationRequest = makeRequest();
    render(<ChatInlineElicitation />);

    fireEvent.click(screen.getByText('Vue'));
    fireEvent.click(screen.getByText('Submit'));

    expect(hooks.actions.onElicitationSubmit).toHaveBeenCalledWith({ framework: 'vue' });
  });

  it('skips on the Skip button and on Escape', () => {
    hooks.state.pendingElicitationRequest = makeRequest();
    render(<ChatInlineElicitation />);

    fireEvent.click(screen.getByText('Skip'));
    fireEvent.keyDown(screen.getByText('Which framework?'), { key: 'Escape' });

    expect(hooks.actions.onElicitationSkip).toHaveBeenCalledTimes(2);
    expect(hooks.actions.onElicitationCancel).not.toHaveBeenCalled();
  });

  it('cancels from the dismiss button', () => {
    hooks.state.pendingElicitationRequest = makeRequest();
    render(<ChatInlineElicitation />);

    fireEvent.click(screen.getByLabelText('Cancel this tool call'));

    expect(hooks.actions.onElicitationCancel).toHaveBeenCalledTimes(1);
    expect(hooks.actions.onElicitationSkip).not.toHaveBeenCalled();
  });

  it('shows the error and keeps the form interactive for a retry', () => {
    hooks.state.pendingElicitationRequest = makeRequest();
    hooks.state.elicitationError = 'Network unreachable';
    render(<ChatInlineElicitation />);

    expect(screen.getByText('Network unreachable')).not.toBeNull();

    fireEvent.click(screen.getByText('Submit'));
    expect(hooks.actions.onElicitationSubmit).toHaveBeenCalledTimes(1);
  });
});
