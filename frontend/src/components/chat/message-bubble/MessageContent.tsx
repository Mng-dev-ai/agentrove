import { memo } from 'react';
import { MessageRenderer } from './MessageRenderer';
import type { AgentKind, AssistantStreamEvent, MessageAttachment } from '@/types/chat.types';
import { MessageAttachments } from './MessageAttachments';
import styles from './MessageContent.module.scss';

interface SharedContentProps {
  contentRender: {
    events: AssistantStreamEvent[];
  };
  attachments: MessageAttachment[];
  isStreaming: boolean;
  chatId?: string;
}

interface UserMessageContentProps extends SharedContentProps {
  uploadingAttachmentIds?: string[];
}

export const UserMessageContent = memo(function UserMessageContent({
  contentRender,
  attachments,
  uploadingAttachmentIds,
  isStreaming,
  chatId,
}: UserMessageContentProps) {
  return (
    <div className={styles['user-content']}>
      <MessageAttachments
        attachments={attachments}
        uploadingAttachmentIds={uploadingAttachmentIds}
        chatId={chatId}
      />
      <MessageRenderer
        events={contentRender.events}
        isStreaming={isStreaming}
        chatId={chatId}
        highlightMentions
      />
    </div>
  );
});

interface AssistantMessageContentProps extends SharedContentProps {
  omittedToolResults?: { chatId: string; messageId: string };
  isCompleted: boolean;
  isLastBotMessage?: boolean;
  durationMs?: number | null;
  onSuggestionSelect?: (suggestion: string) => void;
  agentKind?: AgentKind;
}

export const AssistantMessageContent = memo(function AssistantMessageContent({
  contentRender,
  attachments,
  isStreaming,
  isCompleted,
  chatId,
  isLastBotMessage,
  durationMs,
  onSuggestionSelect,
  agentKind,
  omittedToolResults,
}: AssistantMessageContentProps) {
  return (
    <div className={styles['assistant-content']}>
      <MessageRenderer
        events={contentRender.events}
        omittedToolResults={omittedToolResults}
        isStreaming={isStreaming}
        isCompleted={isCompleted}
        chatId={chatId}
        isLastBotMessage={isLastBotMessage}
        durationMs={durationMs}
        onSuggestionSelect={onSuggestionSelect}
        agentKind={agentKind}
      />

      <MessageAttachments
        attachments={attachments}
        className={styles.attachments}
        chatId={chatId}
      />
    </div>
  );
});
