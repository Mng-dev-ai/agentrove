import { useUIStore } from '@/store/uiStore';
import { useActiveChat } from '@/hooks/useActiveChat';
import { CreateSubThreadDialog } from '@/components/chat/sub-threads/CreateSubThreadDialog';

// Mount-gated (like git dialogs) so useActiveChat doesn't re-render the whole page.
export function SubThreadDialog() {
  // Parent is the focused pane's chat (split chat when that pane is active).
  const parentChat = useActiveChat();
  if (!parentChat || parentChat.parent_chat_id) return null;
  return (
    <CreateSubThreadDialog
      parentChat={parentChat}
      onClose={() => useUIStore.getState().setSubThreadDialogOpen(false)}
    />
  );
}
