import { memo } from 'react';
import clsx from 'clsx';
import { CheckCircle2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { useChatCopiedMessageContext } from '@/hooks/useChatCopiedMessageContext';
import type { MessageAttachment } from '@/types/chat.types';
import styles from './MessageActions.module.scss';

interface MessageActionsProps {
  messageId: string;
  contentText: string;
  attachments?: MessageAttachment[];
  copyLabel?: string;
  showTooltip?: boolean;
}

export const MessageActions = memo(function MessageActions({
  messageId,
  contentText,
  attachments,
  copyLabel = 'Copy',
  showTooltip = true,
}: MessageActionsProps) {
  // Read from the dedicated context, not ChatSessionState — the session state
  // object changes on every stream flush, which would re-render every visible
  // message's action bar for the whole turn.
  const { copiedMessageId, onCopy } = useChatCopiedMessageContext();

  const label = copiedMessageId === messageId ? 'Copied!' : copyLabel;

  const button = (
    <Button
      onClick={() => onCopy(contentText, messageId, attachments)}
      aria-label={label}
      variant="unstyled"
      className={clsx(
        styles['copy-button'],
        copiedMessageId === messageId
          ? styles['copy-button--copied']
          : styles['copy-button--default'],
      )}
    >
      {copiedMessageId === messageId ? (
        <CheckCircle2 className={styles['copy-icon']} />
      ) : (
        <Copy className={styles['copy-icon']} />
      )}
    </Button>
  );

  return (
    <div
      className={styles['message-actions']}
      data-copied={copiedMessageId === messageId || undefined}
    >
      {showTooltip ? (
        <Tooltip content={label} position="top">
          {button}
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
});
