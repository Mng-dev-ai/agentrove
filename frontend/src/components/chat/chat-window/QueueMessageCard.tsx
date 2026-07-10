import { memo, useState, useCallback, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { X, Pencil, CornerDownRight, FileText, FileSpreadsheet, Send } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { apiClient } from '@/lib/api';
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

        const blob = await fetchAttachmentBlob(attachment.file_url, apiClient);
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
  }, [attachment.file_url, attachment.file_type]);

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

export const QueueMessageCard = memo(function QueueMessageCard({
  message,
  onCancel,
  onEdit,
  onSendNow,
}: QueueMessageCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasLocalFiles = message.files && message.files.length > 0;
  const hasServerAttachments = message.attachments && message.attachments.length > 0;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(editContent.length, editContent.length);
    }
  }, [isEditing, editContent.length]);

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content);
    setIsEditing(true);
  }, [message.content]);

  const handleCancelEdit = useCallback(() => {
    setEditContent(message.content);
    setIsEditing(false);
  }, [message.content]);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editContent.trim();
    if (!trimmed) {
      onCancel(message.id);
    } else {
      onEdit(message.id, trimmed);
    }
    setIsEditing(false);
  }, [editContent, message.id, onCancel, onEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSaveEdit();
      } else if (e.key === 'Escape') {
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit],
  );

  return (
    <div className={styles.card}>
      <div className={styles['card-row']}>
        <div className={styles['card-main']}>
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
            <Input
              ref={inputRef}
              variant="unstyled"
              type="text"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Edit message"
              className={styles['edit-input']}
            />
          ) : (
            <span className={styles['message-preview']}>
              <HighlightedText text={message.content} />
            </span>
          )}
        </div>
        <div className={styles['card-actions']}>
          {message.sendingNow ? (
            <span className={styles.sending}>
              <Spinner size="xs" />
              Sending...
            </span>
          ) : isEditing ? (
            <>
              <Button
                onClick={handleSaveEdit}
                variant="unstyled"
                className={clsx(styles['action-btn'], styles['action-btn--save'])}
              >
                Save
              </Button>
              <Button
                onClick={handleCancelEdit}
                variant="unstyled"
                className={clsx(styles['action-btn'], styles['action-btn--cancel-edit'])}
              >
                Cancel
              </Button>
            </>
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
      </div>
    </div>
  );
});
