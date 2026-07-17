import { memo } from 'react';
import { Chat as ChatComponent } from '@/components/chat/chat-window/Chat';
import { ChatSessionOrchestrator } from '@/components/chat/chat-window/ChatSessionOrchestrator';
import { ChatProvider } from '@/contexts/ChatContext';
import { useChatData } from '@/hooks/useChatData';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useWorkspaceResourcesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsForChatQuery } from '@/hooks/queries/useSettingsQueries';

interface AgentPaneProps {
  chatId: string;
}

// Each instance subscribes to its own messages query and SSE stream via
// useChatStreaming inside ChatSessionOrchestrator. Streaming demuxes by
// envelope.chatId so two panes can stream concurrently.
export const AgentPane = memo(function AgentPane({ chatId }: AgentPaneProps) {
  const { currentChat, fetchedMessages, hasFetchedMessages, messagesQuery } = useChatData(chatId);
  const { fileStructure } = useSandboxFiles(currentChat, chatId);
  const { data: workspaceResources } = useWorkspaceResourcesQuery(
    currentChat?.workspace_id,
    chatId,
  );
  // Personas come from the instance that owns the chat (local or cloud VPS).
  const { data: settings } = useSettingsForChatQuery(chatId);

  return (
    <ChatProvider
      chatId={chatId}
      sandboxId={currentChat?.sandbox_id}
      worktreeCwd={currentChat?.worktree_cwd ?? undefined}
      parentChatId={currentChat?.parent_chat_id ?? undefined}
      fileStructure={fileStructure}
      customSkills={workspaceResources?.skills}
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
        <ChatComponent />
      </ChatSessionOrchestrator>
    </ChatProvider>
  );
});
