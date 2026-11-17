import { memo, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Undo2 } from 'lucide-react';
import { UserMessageContent, AssistantMessageContent } from './MessageContent';
import { MessageActions } from './MessageActions';
import { NoticeCard } from './NoticeCard';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import {
  getAgentKindForModelId,
  type AssistantStreamEvent,
  type MessageAttachment,
} from '@/types/chat.types';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { formatRelativeTime, formatFullTimestamp } from '@/utils/date';
import { useChatContext } from '@/hooks/useChatContext';
import { useSetChatInputMessage } from '@/hooks/useChatInputMessageContext';
import { useCheckpointRestore } from '@/hooks/useCheckpointRestore';
import { useChatMachineId } from '@/store/machineOrigin';
import styles from './Message.module.scss';

// The latest message keeps its actions visible; earlier ones reveal them on hover/focus.
export function MessageRow({
  children,
  isLatest,
  className,
}: {
  children: ReactNode;
  isLatest?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx(styles.message, isLatest && styles['message--latest'], className)}>
      <div className={styles['message-row']}>
        <div className={styles['message-body']}>{children}</div>
      </div>
    </div>
  );
}

export function MessageText({ children }: { children: ReactNode }) {
  return <div className={styles['message-text']}>{children}</div>;
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className={styles['user-bubble']}>
      <MessageText>{children}</MessageText>
    </div>
  );
}

export function UserActions({ children }: { children: ReactNode }) {
  return <div className={clsx(styles['user-actions'], styles.reveal)}>{children}</div>;
}

export function AgentActions({ children }: { children: ReactNode }) {
  return <div className={clsx(styles['agent-actions'], styles.reveal)}>{children}</div>;
}

interface SharedContentProps {
  contentRender: {
    events: AssistantStreamEvent[];
  };
  attachments: MessageAttachment[];
  isStreaming: boolean;
}

export interface UserMessageProps extends SharedContentProps {
  id: string;
  contentText: string;
  uploadingAttachmentIds?: string[];
  isLatest?: boolean;
  // An assistant reply follows in the same turn
  hasReply?: boolean;
}

export const UserMessage = memo(function UserMessage({
  id,
  contentText,
  contentRender,
  attachments,
  uploadingAttachmentIds,
  isStreaming,
  isLatest,
  hasReply,
}: UserMessageProps) {
  const { chatId } = useChatContext();

  const noticeText = contentRender.events
    .filter((event) => event.type === 'app_notice')
    .map((event) => event.text)
    .join('\n\n');
  if (noticeText) {
    return (
      <MessageRow className={hasReply ? styles['message--notice-before-reply'] : undefined}>
        <NoticeCard text={noticeText} />
      </MessageRow>
    );
  }

  return (
    <MessageRow isLatest={isLatest}>
      <UserBubble>
        <UserMessageContent
          contentRender={contentRender}
          attachments={attachments}
          uploadingAttachmentIds={uploadingAttachmentIds}
          isStreaming={isStreaming}
          chatId={chatId}
        />
      </UserBubble>

      {contentText.trim() && !isStreaming && (
        <UserActions>
          <MessageActions messageId={id} contentText={contentText} />
        </UserActions>
      )}
    </MessageRow>
  );
});

export interface AssistantMessageProps extends SharedContentProps {
  contentText: string;
  id: string;
  checkpointId: string | null;
  createdAt?: string;
  modelId?: string;
  durationMs?: number | null;
  isLastBotMessage?: boolean;
  isLatest?: boolean;
  toolResultsOmitted: boolean;
  isCompleted: boolean;
}

export const AssistantMessage = memo(function AssistantMessage({
  id,
  checkpointId,
  contentText,
  contentRender,
  attachments,
  isStreaming,
  createdAt,
  modelId,
  durationMs,
  isLastBotMessage,
  isLatest,
  toolResultsOmitted,
  isCompleted,
}: AssistantMessageProps) {
  const { chatId, sandboxId } = useChatContext();
  const setInputMessage = useSetChatInputMessage();
  const onSuggestionSelect = isLastBotMessage ? setInputMessage : undefined;
  const modelMap = useModelMap({ machineId: useChatMachineId(chatId) });
  const [restoreOpen, setRestoreOpen] = useState(false);
  const { restore, isRestoring } = useCheckpointRestore(chatId, id, sandboxId);

  const relativeTime = createdAt ? formatRelativeTime(createdAt) : '';
  const fullTimestamp = createdAt ? formatFullTimestamp(createdAt) : '';
  const modelName = useMemo(() => {
    if (!modelId) return null;
    const model = modelMap.get(modelId);
    if (model?.name) return model.name;
    // Strip only the agent prefix (everything up to and including the first
    // colon). Using split(':').pop() would drop anything after later colons
    // — e.g. opencode IDs like `opencode:openrouter/x-ai/grok-4:free` would
    // become "free" instead of "openrouter/x-ai/grok-4:free".
    const colonIdx = modelId.indexOf(':');
    return colonIdx === -1 ? modelId : modelId.slice(colonIdx + 1);
  }, [modelId, modelMap]);

  // modelId tells us which agent produced the tool calls embedded in this
  // message, so tool renderers can handle per-agent rawInput shape variations
  // (e.g. Copilot's apply_patch vs. Codex's structured changes).
  const agentKind = modelId ? getAgentKindForModelId(modelId) : undefined;
  const omittedToolResults = useMemo(
    () => (toolResultsOmitted && chatId ? { chatId, messageId: id } : undefined),
    [toolResultsOmitted, chatId, id],
  );
  const hasContentText = contentText.trim().length > 0;
  const showFooter = (hasContentText || checkpointId != null) && !isStreaming;

  return (
    <MessageRow isLatest={isLatest}>
      <MessageText>
        <AssistantMessageContent
          contentRender={contentRender}
          attachments={attachments}
          isStreaming={isStreaming}
          isCompleted={isCompleted}
          chatId={chatId}
          isLastBotMessage={isLastBotMessage}
          durationMs={durationMs}
          onSuggestionSelect={onSuggestionSelect}
          agentKind={agentKind}
          omittedToolResults={omittedToolResults}
        />
      </MessageText>

      {showFooter && (
        <div className={clsx(styles.footer, styles.reveal)}>
          <div className={styles['footer-actions']}>
            {hasContentText && <MessageActions messageId={id} contentText={contentText} />}
            {checkpointId && (
              <Tooltip content="Restore to before this run" position="top">
                <Button
                  onClick={() => setRestoreOpen(true)}
                  variant="unstyled"
                  disabled={isRestoring}
                  aria-label="Restore to before this run"
                  className={styles['restore-button']}
                >
                  <Undo2 className={styles['restore-icon']} />
                </Button>
              </Tooltip>
            )}
          </div>

          <div className={styles['footer-meta']}>
            {modelName && <span>{modelName}</span>}
            {modelName && relativeTime && <span>·</span>}
            {relativeTime && (
              <Tooltip content={fullTimestamp} position="top-end">
                <span className={styles['footer-time']}>{relativeTime}</span>
              </Tooltip>
            )}
          </div>
        </div>
      )}
      {restoreOpen && (
        <ConfirmDialog
          destructive
          isOpen
          onClose={() => setRestoreOpen(false)}
          onConfirm={() => restore()}
          title="Restore to before this run?"
          message="The workspace will be reset to the checkpoint captured before this assistant run. Changes made by the run will be discarded."
          confirmLabel="Restore"
        />
      )}
    </MessageRow>
  );
});
