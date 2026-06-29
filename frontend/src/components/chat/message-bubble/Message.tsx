import { memo, useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { UserMessageContent, AssistantMessageContent } from './MessageContent';
import { MessageActions } from './MessageActions';
import { ChangedFilesPanel } from './ChangedFilesPanel';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import {
  getAgentKindForModelId,
  type AssistantStreamEvent,
  type MessageAttachment,
} from '@/types/chat.types';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '@/components/ui/primitives/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatRelativeTime, formatFullTimestamp } from '@/utils/date';
import { useChatContext } from '@/hooks/useChatContext';
import { useChatInputMessageContext } from '@/hooks/useChatInputMessageContext';
import { useCheckpointRestore } from '@/hooks/useCheckpointRestore';

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
    <div className="group px-4 py-1.5 sm:px-6 sm:py-2">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="inline-block max-w-full overflow-hidden rounded-xl bg-surface-hover/60 px-3 py-1.5 dark:bg-surface-dark-tertiary/80">
            <div className="max-w-none break-words text-sm text-text-primary dark:text-text-dark-primary">
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
            <div className="mt-1">
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
    <div className="group px-4 py-1.5 sm:px-6 sm:py-2">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="max-w-none break-words text-sm text-text-primary dark:text-text-dark-primary">
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

          {checkpointId && !isStreaming && <ChangedFilesPanel messageId={id} />}

          {showFooter && (
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-0.5">
                {hasContentText && <MessageActions messageId={id} contentText={contentText} />}
                {checkpointId && (
                  <Tooltip content="Restore to before this run" position="bottom">
                    <Button
                      onClick={() => setRestoreOpen(true)}
                      variant="unstyled"
                      disabled={isRestoring}
                      aria-label="Restore to before this run"
                      className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-quaternary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                {modelName && <span>{modelName}</span>}
                {modelName && relativeTime && <span>·</span>}
                {relativeTime && (
                  <Tooltip content={fullTimestamp} position="bottom">
                    <span className="cursor-default">{relativeTime}</span>
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
