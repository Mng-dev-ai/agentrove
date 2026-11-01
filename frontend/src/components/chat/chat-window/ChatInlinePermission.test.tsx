// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInlinePermission } from './ChatInlinePermission';
import {
  ChatSessionActionsContext,
  ChatSessionStateContext,
  type ChatSessionActions,
  type ChatSessionState,
} from '@/contexts/ChatSessionContextDefinition';
import type { PermissionRequest } from '@/types/chat.types';

function makeRequest(over: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    request_id: 'req-1',
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    seq: 1,
    options: [
      { kind: 'allow_once', name: 'Allow', option_id: 'opt-allow' },
      { kind: 'reject_once', name: 'Reject', option_id: 'opt-reject' },
    ],
    ...over,
  };
}

function renderWithSession(pendingPermissionRequest: PermissionRequest | null) {
  const state = {
    pendingPermissionRequest,
    isPermissionLoading: false,
    permissionError: null,
  } as ChatSessionState;
  const actions = {
    onPermissionApprove: vi.fn(),
    onPermissionReject: vi.fn(),
  } as Partial<ChatSessionActions> as ChatSessionActions;
  const { container } = render(
    <ChatSessionStateContext value={state}>
      <ChatSessionActionsContext value={actions}>
        <ChatInlinePermission />
      </ChatSessionActionsContext>
    </ChatSessionStateContext>,
  );
  return { container, actions };
}

describe('ChatInlinePermission', () => {
  afterEach(cleanup);

  it('renders nothing when there is no pending request', () => {
    const { container } = renderWithSession(null);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for an ExitPlanMode request', () => {
    const { container } = renderWithSession(makeRequest({ tool_name: 'ExitPlanMode' }));
    expect(container.firstChild).toBeNull();
  });

  it('routes the chosen option to the session approve/reject actions', () => {
    const { actions } = renderWithSession(makeRequest());

    fireEvent.click(screen.getByRole('button', { name: /Allow/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }));

    expect(actions.onPermissionApprove).toHaveBeenCalledExactlyOnceWith('opt-allow');
    expect(actions.onPermissionReject).toHaveBeenCalledExactlyOnceWith('opt-reject');
  });
});
