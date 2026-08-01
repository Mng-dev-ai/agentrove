import { memo } from 'react';
import { ElicitationInline } from '@/components/chat/tools/ElicitationInline';
import { useChatSessionState, useChatSessionActions } from '@/hooks/useChatSessionContext';
import styles from './ChatInlineElicitation.module.scss';

export const ChatInlineElicitation = memo(function ChatInlineElicitation() {
  const state = useChatSessionState();
  const actions = useChatSessionActions();

  // A pending permission blocks the same turn and owns the slot.
  if (!state.pendingElicitationRequest || state.pendingPermissionRequest) {
    return null;
  }

  return (
    <div className={styles['inline-elicitation']}>
      <ElicitationInline
        request={state.pendingElicitationRequest}
        onSubmit={actions.onElicitationSubmit}
        onSkip={actions.onElicitationSkip}
        onCancel={actions.onElicitationCancel}
        isLoading={state.isElicitationLoading}
        error={state.elicitationError}
      />
    </div>
  );
});
