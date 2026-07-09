import { memo } from 'react';
import { ToolPermissionInline } from '@/components/chat/tools/ToolPermissionInline';
import { useChatSessionState, useChatSessionActions } from '@/hooks/useChatSessionContext';
import styles from './ChatInlinePermission.module.scss';

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
    <div className={styles['inline-permission']}>
      <ToolPermissionInline
        request={state.pendingPermissionRequest}
        onApprove={actions.onPermissionApprove}
        onReject={actions.onPermissionReject}
        isLoading={state.isPermissionLoading}
        error={state.permissionError}
      />
    </div>
  );
});
