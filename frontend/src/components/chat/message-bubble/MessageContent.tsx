import { memo } from 'react';
import { MessageRenderer } from './MessageRenderer';
import type { AgentKind, AssistantStreamEvent, MessageAttachment } from '@/types/chat.types';
import { MessageAttachments } from './MessageAttachments';

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
    <div className="space-y-1">
      <MessageAttachments
        attachments={attachments}
        uploadingAttachmentIds={uploadingAttachmentIds}
        chatId={chatId}
      />
      <MessageRenderer events={contentRender.events} isStreaming={isStreaming} chatId={chatId} />
    </div>
  );
});

interface AssistantMessageContentProps extends SharedContentProps {
  isLastBotMessage?: boolean;
  durationMs?: number | null;
  onSuggestionSelect?: (suggestion: string) => void;
  agentKind?: AgentKind;
}

export const AssistantMessageContent = memo(function AssistantMessageContent({
  contentRender,
  attachments,
  isStreaming,
  chatId,
  isLastBotMessage,
  durationMs,
  onSuggestionSelect,
  agentKind,
}: AssistantMessageContentProps) {
  return (
    <div className="space-y-4">
      <MessageRenderer
        events={contentRender.events}
        isStreaming={isStreaming}
        chatId={chatId}
        isLastBotMessage={isLastBotMessage}
        durationMs={durationMs}
        onSuggestionSelect={onSuggestionSelect}
        agentKind={agentKind}
      />

      <MessageAttachments attachments={attachments} className="mt-3" chatId={chatId} />
    </div>
  );
});
