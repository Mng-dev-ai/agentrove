import { memo, useMemo } from 'react';
import { X } from 'lucide-react';
import { Chat as ChatComponent } from '@/components/chat/chat-window/Chat';
import { ChatSessionOrchestrator } from '@/components/chat/chat-window/ChatSessionOrchestrator';
import { ChatProvider } from '@/contexts/ChatContext';
import { useChatData } from '@/hooks/useChatData';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useWorkspaceResourcesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsForChatQuery } from '@/hooks/queries/useSettingsQueries';
import { useUIStore } from '@/store/uiStore';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import styles from './AgentPane.module.scss';

interface AgentPaneProps {
  chatId: string;
}

// Own messages query + SSE via ChatSessionOrchestrator; demux by envelope.chatId for split panes.
export const AgentPane = memo(function AgentPane({ chatId }: AgentPaneProps) {
  const { currentChat, fetchedMessages, hasFetchedMessages, messagesQuery } = useChatData(chatId);
  const { fileStructure } = useSandboxFiles(currentChat, chatId);
  const { data: workspaceResources } = useWorkspaceResourcesQuery(
    currentChat?.workspace_id,
    chatId,
  );
  // Personas come from the instance that owns the chat (local or cloud VPS).
  const { data: settings } = useSettingsForChatQuery(chatId);
  const closeButton = useMemo(
    () => (
      <FloatingTooltip content="Close split">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={styles['close-button']}
          onClick={() => useUIStore.getState().closeSplitChat(chatId)}
          aria-label="Close split"
        >
          <X className={styles['close-icon']} />
        </Button>
      </FloatingTooltip>
    ),
    [chatId],
  );

  return (
    <ChatProvider
      chatId={chatId}
      sandboxId={currentChat?.sandbox_id}
      worktreeCwd={currentChat?.worktree_cwd ?? undefined}
      parentChatId={currentChat?.parent_chat_id ?? undefined}
      fileStructure={fileStructure}
      builtinSlashCommands={workspaceResources?.builtin_slash_commands}
      personas={settings?.personas}
    >
      <ChatSessionOrchestrator
        chatId={chatId}
        currentChat={currentChat}
        fetchedMessages={fetchedMessages}
        hasFetchedMessages={hasFetchedMessages}
        messagesQuery={messagesQuery}
        useRouteInitialPrompt={false}
      >
        <ChatComponent corner={closeButton} />
      </ChatSessionOrchestrator>
    </ChatProvider>
  );
});
