import { memo } from 'react';
import clsx from 'clsx';
import { CheckCircle2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { useChatSessionActions } from '@/hooks/useChatSessionContext';
import { useChatCopiedMessageContext } from '@/hooks/useChatCopiedMessageContext';
import styles from './MessageActions.module.scss';

interface MessageActionsProps {
  messageId: string;
  contentText: string;
  copyLabel?: string;
  showTooltip?: boolean;
}

export const MessageActions = memo(function MessageActions({
  messageId,
  contentText,
  copyLabel = 'Copy',
  showTooltip = true,
}: MessageActionsProps) {
  // Read from the dedicated context, not ChatSessionState — the session state
  // object changes on every stream flush, which would re-render every visible
  // message's action bar for the whole turn.
  const { copiedMessageId } = useChatCopiedMessageContext();
  const { onCopy } = useChatSessionActions();

  const button = (
    <Button
      onClick={() => onCopy(contentText, messageId)}
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
    <div className={styles['message-actions']}>
      {showTooltip ? (
        <Tooltip content={copiedMessageId === messageId ? 'Copied!' : copyLabel} position="bottom">
          {button}
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
});
