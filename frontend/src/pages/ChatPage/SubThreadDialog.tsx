import { useUIStore } from '@/store/uiStore';
import { useActiveChat } from '@/hooks/useActiveChat';
import { CreateSubThreadDialog } from '@/components/chat/sub-threads/CreateSubThreadDialog';

// Mount-gated wrapper (matches the git dialogs' pattern) so useActiveChat's
// pane subscriptions don't re-render the whole page on every pane switch.
export function SubThreadDialog() {
  // Sub-threads branch off the pane the user is in — in split view that's the
  // secondary chat when it's the active pane.
  const parentChat = useActiveChat();
  if (!parentChat || parentChat.parent_chat_id) return null;
  return (
    <CreateSubThreadDialog
      parentChat={parentChat}
      onClose={() => useUIStore.getState().setSubThreadDialogOpen(false)}
    />
  );
}
