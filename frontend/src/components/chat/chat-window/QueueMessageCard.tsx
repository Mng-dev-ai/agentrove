import { memo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import clsx from 'clsx';
import { X, Pencil, CornerDownRight, FileText, FileSpreadsheet, Send } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { resolveChatClient } from '@/lib/api';
import { useChatContext } from '@/hooks/useChatContext';
import { useSetChatInputMessage } from '@/hooks/useChatInputMessageContext';
import { detectFileType } from '@/utils/fileTypes';
import { HighlightedText } from '@/components/ui/shared/HighlightedText/HighlightedText';
import { fetchAttachmentBlob } from '@/utils/file';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import type {
  LocalQueuedMessage,
  QueueMessageAttachment as QueueAttachment,
} from '@/types/queue.types';
import styles from './QueueMessageCard.module.scss';

interface QueueMessageCardProps {
  message: LocalQueuedMessage;
  onCancel: (messageId: string) => void;
  onEdit: (messageId: string, newContent: string) => void;
  onSendNow: (messageId: string) => void;
  rescued: boolean;
  onDirtyChange: (messageId: string, dirty: boolean) => void;
  onDiscard: (messageId: string) => void;
}

function UploadingOverlay() {
  return (
    <div className={styles['uploading-overlay']}>
      <div className={styles['uploading-overlay-inner']}>
        <Spinner size="xs" className={styles['uploading-spinner']} />
      </div>
    </div>
  );
}

function LocalFilePreview({ file, uploading }: { file: File; uploading: boolean }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'image' | 'pdf' | 'xlsx' | 'unknown'>('unknown');

  useEffect(() => {
    let objectUrl: string | null = null;

    try {
      const detectedType = detectFileType(file.name, file.type);
      setFileType(detectedType);

      if (detectedType === 'image') {
        objectUrl = URL.createObjectURL(file);
        setImageSrc(objectUrl);
      }
    } catch {
      setFileType('unknown');
    }

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file]);

  if (fileType === 'image' && imageSrc) {
    return (
      <div className={styles['file-thumb']}>
        <img
          src={imageSrc}
          alt={file.name || 'Attachment'}
          className={styles['file-thumb-image']}
        />
        {uploading && <UploadingOverlay />}
      </div>
    );
  }

  if (fileType === 'xlsx') {
    return (
      <div className={clsx(styles['file-thumb-icon'], styles['file-thumb-icon--overlay'])}>
        <FileSpreadsheet className={clsx(styles['thumb-icon'], styles['thumb-icon--success'])} />
        {uploading && <UploadingOverlay />}
      </div>
    );
  }

  if (fileType === 'pdf') {
    return (
      <div className={clsx(styles['file-thumb-icon'], styles['file-thumb-icon--overlay'])}>
        <FileText className={clsx(styles['thumb-icon'], styles['thumb-icon--error'])} />
        {uploading && <UploadingOverlay />}
      </div>
    );
  }

  return (
    <div className={clsx(styles['file-thumb-icon'], styles['file-thumb-icon--overlay'])}>
      <FileText className={clsx(styles['thumb-icon'], styles['thumb-icon--muted'])} />
      {uploading && <UploadingOverlay />}
    </div>
  );
}

function AuthenticatedPreview({ attachment }: { attachment: QueueAttachment }) {
  // A remote chat's attachment URLs only exist on its machine — route like AttachmentViewer.
  const { chatId } = useChatContext();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadImage() {
      try {
        if (isBrowserObjectUrl(attachment.file_url)) {
          setImageSrc(attachment.file_url);
          setIsLoading(false);
          return;
        }

        const blob = await fetchAttachmentBlob(attachment.file_url, resolveChatClient(chatId));
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageSrc(objectUrl);
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setIsLoading(false);
        }
      }
    }

    if (attachment.file_type === 'image') {
      loadImage();
    } else {
      setIsLoading(false);
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.file_url, attachment.file_type, chatId]);

  if (attachment.file_type === 'pdf') {
    return (
      <div className={styles['file-thumb-icon']}>
        <FileText className={clsx(styles['thumb-icon'], styles['thumb-icon--error'])} />
      </div>
    );
  }

  if (attachment.file_type === 'xlsx') {
    return (
      <div className={styles['file-thumb-icon']}>
        <FileSpreadsheet className={clsx(styles['thumb-icon'], styles['thumb-icon--success'])} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles['file-thumb-icon']}>
        <div className={styles['thumb-loading']} />
      </div>
    );
  }

  if (error || !imageSrc) {
    return (
      <div className={styles['file-thumb-icon']}>
        <span className={styles['thumb-error']}>Error</span>
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={attachment.filename || 'Attachment'}
      className={styles['file-thumb-image']}
    />
  );
}

function fitHeight(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export const QueueMessageCard = memo(function QueueMessageCard({
  message,
  onCancel,
  onEdit,
  onSendNow,
  rescued,
  onDirtyChange,
  onDiscard,
}: QueueMessageCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setComposerMessage = useSetChatInputMessage();
  const draft = editContent.trim();
  const isDirty = isEditing && draft !== '' && draft !== message.content;
  const hasLocalFiles = message.files && message.files.length > 0;
  const hasServerAttachments = message.attachments && message.attachments.length > 0;

  useLayoutEffect(() => {
    if (textareaRef.current) fitHeight(textareaRef.current);
  }, [editContent, isEditing]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let width = textarea.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitHeight(textarea));
    });
    observer.observe(textarea);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [isEditing]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (isEditing && textarea) {
      const end = textarea.value.length;
      textarea.focus();
      textarea.setSelectionRange(end, end);
      textarea.scrollTop = textarea.scrollHeight;
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isDirty) return;
    onDirtyChange(message.id, true);
    return () => onDirtyChange(message.id, false);
  }, [isDirty, message.id, onDirtyChange]);

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content);
    setIsEditing(true);
  }, [message.content]);

  const handleCancelEdit = useCallback(() => {
    setEditContent(message.content);
    setIsEditing(false);
  }, [message.content]);

  const handleSaveEdit = useCallback(() => {
    if (!draft) {
      onCancel(message.id);
    } else {
      onEdit(message.id, draft);
    }
    setIsEditing(false);
  }, [draft, message.id, onCancel, onEdit]);

  const handleMoveToComposer = useCallback(() => {
    setComposerMessage((current) => (current.trim() ? `${current}\n\n${draft}` : draft));
    onDiscard(message.id);
  }, [draft, message.id, onDiscard, setComposerMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (rescued) handleMoveToComposer();
        else handleSaveEdit();
      } else if (e.key === 'Escape' && !rescued) {
        handleCancelEdit();
      }
    },
    [rescued, handleMoveToComposer, handleSaveEdit, handleCancelEdit],
  );

  return (
    <div className={styles.card}>
      <div className={styles['card-row']}>
        <div className={clsx(styles['card-main'], isEditing && styles['card-main--editing'])}>
          <CornerDownRight className={styles['reply-icon']} />
          {hasLocalFiles && !hasServerAttachments && (
            <div className={styles.thumbs}>
              {message.files!.map((file, idx) => (
                <LocalFilePreview
                  key={`${file.name}-${file.lastModified}-${idx}`}
                  file={file}
                  uploading={!message.synced}
                />
              ))}
            </div>
          )}
          {hasServerAttachments && message.attachments && (
            <div className={styles.thumbs}>
              {message.attachments.map((att, idx) => (
                <AuthenticatedPreview key={att.file_url || idx} attachment={att} />
              ))}
            </div>
          )}
          {isEditing ? (
            <Textarea
              ref={textareaRef}
              variant="unstyled"
              rows={1}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Edit message"
              className={styles['edit-textarea']}
            />
          ) : (
            <span className={styles['message-preview']}>
              <HighlightedText text={message.content} />
            </span>
          )}
        </div>
        {!isEditing && (
          <div className={styles['card-actions']}>
            {message.sendingNow ? (
              <span className={styles.sending}>
                <Spinner size="xs" />
                Sending...
              </span>
            ) : (
              <>
                {message.synced && (
                  <Button
                    onClick={() => onSendNow(message.id)}
                    variant="unstyled"
                    className={clsx(styles['action-btn'], styles['action-btn--icon'])}
                    aria-label="Send now"
                  >
                    <Send className={styles['action-glyph']} />
                  </Button>
                )}
                <Button
                  onClick={handleStartEdit}
                  variant="unstyled"
                  className={clsx(styles['action-btn'], styles['action-btn--icon'])}
                  aria-label="Edit message"
                >
                  <Pencil className={styles['action-glyph']} />
                </Button>
                <Button
                  onClick={() => onCancel(message.id)}
                  variant="unstyled"
                  className={clsx(styles['action-btn'], styles['action-btn--delete'])}
                  aria-label="Cancel message"
                >
                  <X className={styles['action-glyph']} />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {rescued ? (
        <div className={styles['edit-footer']}>
          <span className={styles['rescued-note']}>Original already sent. Edit not saved.</span>
          <Button
            onClick={() => onDiscard(message.id)}
            variant="unstyled"
            className={clsx(styles['action-btn'], styles['action-btn--cancel-edit'])}
          >
            Discard
          </Button>
          <Button
            onClick={handleMoveToComposer}
            variant="unstyled"
            className={clsx(styles['action-btn'], styles['action-btn--save'])}
          >
            Move to composer
          </Button>
        </div>
      ) : (
        isEditing && (
          <div className={styles['edit-footer']}>
            <Button
              onClick={handleCancelEdit}
              variant="unstyled"
              className={clsx(styles['action-btn'], styles['action-btn--cancel-edit'])}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              variant="unstyled"
              className={clsx(styles['action-btn'], styles['action-btn--save'])}
            >
              Save
            </Button>
          </div>
        )
      )}
    </div>
  );
});
