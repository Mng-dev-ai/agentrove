import { memo, useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { UserMessageContent, AssistantMessageContent } from './MessageContent';
import { MessageActions } from './MessageActions';
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
import { useChatInputMessageContext } from '@/hooks/useChatInputMessageContext';
import { useCheckpointRestore } from '@/hooks/useCheckpointRestore';
import styles from './Message.module.scss';

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
}

export const UserMessage = memo(function UserMessage({
  id,
  contentText,
  contentRender,
  attachments,
  uploadingAttachmentIds,
  isStreaming,
}: UserMessageProps) {
  const { chatId } = useChatContext();

  return (
    <div className={styles.message}>
      <div className={styles['message-row']}>
        <div className={styles['message-body']}>
          <div className={styles['user-bubble']}>
            <div className={styles['message-text']}>
              <UserMessageContent
                contentRender={contentRender}
                attachments={attachments}
                uploadingAttachmentIds={uploadingAttachmentIds}
                isStreaming={isStreaming}
                chatId={chatId}
              />
            </div>
          </div>

          {contentText.trim() && !isStreaming && (
            <div className={styles['actions-slot']}>
              <MessageActions messageId={id} contentText={contentText} />
            </div>
          )}
        </div>
      </div>
    </div>
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
}: AssistantMessageProps) {
  const { chatId, sandboxId } = useChatContext();
  const { setInputMessage } = useChatInputMessageContext();
  const onSuggestionSelect = isLastBotMessage ? setInputMessage : undefined;
  const modelMap = useModelMap();
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
  const hasContentText = contentText.trim().length > 0;
  const showFooter = (hasContentText || checkpointId != null) && !isStreaming;

  return (
    <div className={styles.message}>
      <div className={styles['message-row']}>
        <div className={styles['message-body']}>
          <div className={styles['message-text']}>
            <AssistantMessageContent
              contentRender={contentRender}
              attachments={attachments}
              isStreaming={isStreaming}
              chatId={chatId}
              isLastBotMessage={isLastBotMessage}
              durationMs={durationMs}
              onSuggestionSelect={onSuggestionSelect}
              agentKind={agentKind}
            />
          </div>

          {showFooter && (
            <div className={styles.footer}>
              <div className={styles['footer-actions']}>
                {hasContentText && <MessageActions messageId={id} contentText={contentText} />}
                {checkpointId && (
                  <Tooltip content="Restore to before this run" position="bottom">
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
                  <Tooltip content={fullTimestamp} position="bottom">
                    <span className={styles['footer-time']}>{relativeTime}</span>
                  </Tooltip>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {restoreOpen && (
        <ConfirmDialog
          isOpen
          onClose={() => setRestoreOpen(false)}
          onConfirm={() => restore()}
          title="Restore to before this run?"
          message="The workspace will be reset to the checkpoint captured before this assistant run. Changes made by the run will be discarded."
          confirmLabel="Restore"
        />
      )}
    </div>
  );
});
