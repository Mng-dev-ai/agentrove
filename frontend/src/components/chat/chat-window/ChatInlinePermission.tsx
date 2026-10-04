import { memo, type ReactNode } from 'react';
import { ToolPermissionInline } from '@/components/chat/tools/ToolPermissionInline';
import { useChatSessionState, useChatSessionActions } from '@/hooks/useChatSessionContext';
import type { ToolPermissionRequest } from '@/types/chat.types';
import styles from './ChatInlinePermission.module.scss';

interface InlinePermissionProps {
  request: ToolPermissionRequest;
  onApprove: (optionId: string) => void;
  onReject: (optionId: string) => void;
  isLoading: boolean;
  error: string | null;
  header?: ReactNode;
}

export function InlinePermission({
  request,
  onApprove,
  onReject,
  isLoading,
  error,
  header,
}: InlinePermissionProps) {
  return (
    <div className={styles['inline-permission']}>
      {header}
      <ToolPermissionInline
        request={request}
        onApprove={onApprove}
        onReject={onReject}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}

export const ChatInlinePermission = memo(function ChatInlinePermission() {
  const state = useChatSessionState();
  const actions = useChatSessionActions();

  if (
    !state.pendingPermissionRequest ||
    state.pendingPermissionRequest.tool_name === 'ExitPlanMode'
  ) {
    return null;
  }

  return (
    <InlinePermission
      request={state.pendingPermissionRequest}
      onApprove={actions.onPermissionApprove}
      onReject={actions.onPermissionReject}
      isLoading={state.isPermissionLoading}
      error={state.permissionError}
    />
  );
});
