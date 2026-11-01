// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePermissionStore } from '@/store/permissionStore';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import type { PermissionRequest } from '@/types/chat.types';
import { useExitPlanMode } from './useExitPlanMode';

const { respondToPermission } = vi.hoisted(() => ({ respondToPermission: vi.fn() }));

vi.mock('@/services/permissionService', () => ({ permissionService: { respondToPermission } }));

const CHAT = 'chat-1';

const bashRequest: PermissionRequest = {
  request_id: 'bash-1',
  tool_name: 'Bash',
  tool_input: {},
  options: [],
  seq: 1,
};

const planRequest: PermissionRequest = {
  request_id: 'plan-1',
  tool_name: 'ExitPlanMode',
  tool_input: {},
  options: [
    {
      kind: 'allow_once',
      name: 'Auto-accept edits',
      option_id: 'accept',
      permission_mode: 'acceptEdits',
    },
    { kind: 'reject_once', name: 'Keep planning', option_id: 'reject' },
  ],
  seq: 2,
};

const queuedIds = () =>
  usePermissionStore
    .getState()
    .pendingRequests.get(CHAT)
    ?.map((r) => r.request_id) ?? [];
const permissionMode = () => useChatSettingsStore.getState().permissionModeByChat[CHAT];

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

beforeEach(() => {
  localStorage.clear();
  respondToPermission.mockReset();
  usePermissionStore.setState({ pendingRequests: new Map() });
  useChatSettingsStore.setState({ permissionModeByChat: { [CHAT]: 'plan' } });
  usePermissionStore.getState().enqueuePermissionRequest(CHAT, bashRequest);
  usePermissionStore.getState().enqueuePermissionRequest(CHAT, planRequest);
});

describe('useExitPlanMode', () => {
  it('approves a plan queued behind another request and switches to the chosen mode', async () => {
    respondToPermission.mockResolvedValue(undefined);
    const { result } = renderHook(() => useExitPlanMode(CHAT));
    expect(result.current.pendingRequest?.request_id).toBe('plan-1');

    await act(() => result.current.handleApprove('accept'));

    expect(respondToPermission).toHaveBeenCalledWith(CHAT, 'plan-1', 'accept');
    expect(queuedIds()).toEqual(['bash-1']);
    expect(permissionMode()).toBe('acceptEdits');
    expect(result.current.pendingRequest).toBeNull();
  });

  it('clears an expired plan request without changing the permission mode', async () => {
    respondToPermission.mockRejectedValue(apiError(404, 'Not found'));
    const { result } = renderHook(() => useExitPlanMode(CHAT));

    await act(() => result.current.handleApprove('accept'));

    expect(queuedIds()).toEqual(['bash-1']);
    expect(permissionMode()).toBe('plan');
    expect(result.current.error).toBeNull();
  });

  it('keeps the request and surfaces the error when the response fails', async () => {
    respondToPermission.mockRejectedValue(apiError(500, 'Server exploded'));
    const { result } = renderHook(() => useExitPlanMode(CHAT));

    await act(() => result.current.handleReject('reject'));

    expect(queuedIds()).toEqual(['bash-1', 'plan-1']);
    expect(result.current.error).toBe('Server exploded');
    expect(result.current.isLoading).toBe(false);
  });
});
