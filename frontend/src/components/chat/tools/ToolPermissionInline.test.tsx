// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolPermissionInline } from './ToolPermissionInline';
import type { PermissionRequest } from '@/types/chat.types';

function makeRequest(over: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    request_id: 'req-1',
    tool_name: 'Bash',
    tool_input: { reason: 'Run the test suite', command: 'npm test' },
    seq: 1,
    options: [
      { kind: 'allow_once', name: 'Allow', option_id: 'opt-allow' },
      { kind: 'reject_once', name: 'Reject', option_id: 'opt-reject' },
    ],
    ...over,
  };
}

describe('ToolPermissionInline', () => {
  it('routes allow options to onApprove and reject options to onReject', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <ToolPermissionInline
        request={makeRequest({
          options: [
            { kind: 'allow_once', name: 'Allow once', option_id: 'a1' },
            { kind: 'allow_always', name: 'Always allow', option_id: 'a2' },
            { kind: 'reject_always', name: 'Never allow', option_id: 'r2' },
          ],
        })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Always allow/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Never allow/ }));

    expect(onApprove).toHaveBeenCalledExactlyOnceWith('a2');
    expect(onReject).toHaveBeenCalledExactlyOnceWith('r2');
  });

  it('renders the tool name and command headline', () => {
    render(<ToolPermissionInline request={makeRequest()} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('Run the test suite')).toBeTruthy();
    expect(screen.getByText('npm test')).toBeTruthy();
  });

  it('renders nothing when there is no request', () => {
    const { container } = render(
      <ToolPermissionInline request={null} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for an ExitPlanMode request (handled by the plan-mode UI)', () => {
    const { container } = render(
      <ToolPermissionInline
        request={makeRequest({ tool_name: 'ExitPlanMode' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('disables the option buttons while a response is in flight', () => {
    const onApprove = vi.fn();
    render(
      <ToolPermissionInline
        request={makeRequest()}
        onApprove={onApprove}
        onReject={vi.fn()}
        isLoading
      />,
    );

    const allowButton = screen.getByRole<HTMLButtonElement>('button', { name: /^Allow/ });
    expect(allowButton.disabled).toBe(true);
    fireEvent.click(allowButton);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('surfaces the permission error text', () => {
    render(
      <ToolPermissionInline
        request={makeRequest()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        error="Backend rejected the response"
      />,
    );
    expect(screen.getByText('Backend rejected the response')).toBeTruthy();
  });

  it('collapses an expanded details disclosure when a new request arrives', () => {
    const diagnosticInput = { reason: 'do it', call_id: 'call-123' };
    const { rerender } = render(
      <ToolPermissionInline
        request={makeRequest({ request_id: 'req-1', tool_input: diagnosticInput })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText('call-123')).toBeTruthy();

    rerender(
      <ToolPermissionInline
        request={makeRequest({ request_id: 'req-2', tool_input: diagnosticInput })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Show details' })).toBeTruthy();
    expect(screen.queryByText('call-123')).toBeNull();
  });
});
