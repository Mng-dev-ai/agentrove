// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInlinePermission } from './ChatInlinePermission';
import type { PermissionRequest } from '@/types/chat.types';

vi.mock('@/components/ui/markdown/LazyMarkDown', () => ({
  LazyMarkDown: ({ content }: { content: string }) => <div>{content}</div>,
}));

const hooks = vi.hoisted(() => ({
  state: {
    pendingPermissionRequest: null as PermissionRequest | null,
    isPermissionLoading: false,
    permissionError: null as string | null,
  },
  actions: {
    onPermissionApprove: vi.fn(),
    onPermissionReject: vi.fn(),
  },
}));

// ChatInlinePermission reads the live request and the approve/reject actions
// straight off the chat-session context; mock at that boundary so the test
// drives the same wiring the real provider supplies.
vi.mock('@/hooks/useChatSessionContext', () => ({
  useChatSessionState: () => hooks.state,
  useChatSessionActions: () => hooks.actions,
}));

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

describe('ChatInlinePermission', () => {
  afterEach(() => {
    cleanup();
    hooks.state.pendingPermissionRequest = null;
    hooks.state.isPermissionLoading = false;
    hooks.state.permissionError = null;
    hooks.actions.onPermissionApprove.mockReset();
    hooks.actions.onPermissionReject.mockReset();
  });

  it('renders nothing when there is no pending request', () => {
    const { container } = render(<ChatInlinePermission />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for an ExitPlanMode request', () => {
    hooks.state.pendingPermissionRequest = makeRequest({ tool_name: 'ExitPlanMode' });
    const { container } = render(<ChatInlinePermission />);
    expect(container.firstChild).toBeNull();
  });

  it('forwards the approve action with the selected option id', () => {
    hooks.state.pendingPermissionRequest = makeRequest();
    render(<ChatInlinePermission />);

    fireEvent.click(screen.getByText('Allow'));

    expect(hooks.actions.onPermissionApprove).toHaveBeenCalledWith('opt-allow');
    expect(hooks.actions.onPermissionReject).not.toHaveBeenCalled();
  });

  it('forwards the reject action with the selected option id', () => {
    hooks.state.pendingPermissionRequest = makeRequest();
    render(<ChatInlinePermission />);

    fireEvent.click(screen.getByText('Reject'));

    expect(hooks.actions.onPermissionReject).toHaveBeenCalledWith('opt-reject');
    expect(hooks.actions.onPermissionApprove).not.toHaveBeenCalled();
  });
});
