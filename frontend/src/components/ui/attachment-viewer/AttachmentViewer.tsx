import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import clsx from 'clsx';
import { logger } from '@/utils/logger';
import type { MessageAttachment } from '@/types/chat.types';
import { resolveChatClient } from '@/lib/api';
import { fetchAttachmentBlob, downloadAttachmentFile, getDefaultFilename } from '@/utils/file';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import { ImagePreviewModal } from '../ImagePreviewModal/ImagePreviewModal';
import {
  FileAttachment,
  ImageErrorTile,
  ImageThumbnail,
  ThumbnailWrapper,
  type ImageSize,
  type ImageState,
} from './AttachmentThumbnails';
import styles from './AttachmentViewer.module.scss';

interface AttachmentViewerProps {
  attachments: MessageAttachment[];
  uploadingAttachmentIds?: string[];
  // Routes fetch/download to the machine that owns the chat.
  chatId?: string;
  size?: ImageSize;
}

const DEFAULT_IMAGE_STATE: ImageState = { isLoading: true, error: false, imageSrc: '' };

export const AttachmentViewer = memo(function AttachmentViewer({
  attachments,
  uploadingAttachmentIds,
  chatId,
  size = 'thumbnail',
}: AttachmentViewerProps) {
  const [imageStates, setImageStates] = useState<Record<string, ImageState>>({});
  // Lightbox index into imageAttachments; null = closed.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const ownedObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const uploadingIdSet = useMemo(
    () => new Set(uploadingAttachmentIds ?? []),
    [uploadingAttachmentIds],
  );

  const handleDownload = useCallback(
    async (url: string | File, fileName: string) => {
      if (!url) return;
      try {
        await downloadAttachmentFile(url, fileName, resolveChatClient(chatId));
      } catch (error) {
        logger.error('File download failed', 'AttachmentViewer', error);
        throw error;
      }
    },
    [chatId],
  );

  const imageAttachments = useMemo(
    () => attachments.filter((a) => a.file_type === 'image'),
    [attachments],
  );
  const imageIdKey = useMemo(
    () => imageAttachments.map((a) => a.id).join('\0'),
    [imageAttachments],
  );

  const handleClosePreview = useCallback(() => setPreviewIndex(null), []);
  const handleRetry = useCallback(() => setRetryCount((count) => count + 1), []);

  useEffect(() => {
    const loadedIds = loadedIdsRef.current;
    const imageIds = new Set(imageAttachments.map((attachment) => attachment.id));
    for (const [id, url] of ownedObjectUrlsRef.current) {
      if (!imageIds.has(id)) {
        URL.revokeObjectURL(url);
        ownedObjectUrlsRef.current.delete(id);
        loadedIds.delete(id);
      }
    }
    const newAttachments = imageAttachments.filter((a) => !loadedIds.has(a.id));
    if (newAttachments.length === 0) return;

    for (const attachment of newAttachments) {
      loadedIds.add(attachment.id);
    }
    setImageStates((prev) => {
      const next = { ...prev };
      for (const a of newAttachments) next[a.id] = { isLoading: true, error: false, imageSrc: '' };
      return next;
    });

    let cancelled = false;
    const completedIds = new Set<string>();
    void Promise.all(
      newAttachments.map(async (attachment) => {
        const key = attachment.id;
        try {
          const source = attachment.file_url;
          if (typeof source === 'string' && isBrowserObjectUrl(source)) {
            if (!cancelled) {
              completedIds.add(key);
              setImageStates((prev) => ({
                ...prev,
                [key]: { isLoading: false, error: false, imageSrc: source },
              }));
            }
            return;
          }

          const blob =
            source instanceof File
              ? source
              : await fetchAttachmentBlob(source, resolveChatClient(chatId));
          if (cancelled) return;
          const blobUrl = URL.createObjectURL(blob);
          ownedObjectUrlsRef.current.set(key, blobUrl);
          completedIds.add(key);

          setImageStates((prev) => ({
            ...prev,
            [key]: { isLoading: false, error: false, imageSrc: blobUrl },
          }));
        } catch (error) {
          logger.error('Image download failed', 'AttachmentViewer', error);
          loadedIds.delete(key);
          if (!cancelled) {
            setImageStates((prev) => ({
              ...prev,
              [key]: { isLoading: false, error: true, imageSrc: '' },
            }));
          }
        }
      }),
    );
    return () => {
      cancelled = true;
      // Only remove IDs that never finished loading so the next effect retries them
      for (const a of newAttachments) {
        if (!completedIds.has(a.id)) {
          loadedIds.delete(a.id);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIdKey, retryCount]);

  useEffect(() => {
    const loadedIds = loadedIdsRef.current;
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    return () => {
      ownedObjectUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      ownedObjectUrls.clear();
      loadedIds.clear();
    };
  }, []);

  if (attachments.length === 0) {
    return null;
  }

  const fileAttachments = attachments.filter(
    (a) => a.file_type === 'pdf' || a.file_type === 'xlsx',
  );

  return (
    <>
      <div className={styles.attachments}>
        {imageAttachments.length > 0 && (
          <div className={clsx(styles.list, size === 'large' && styles['list--large'])}>
            {imageAttachments.map((attachment, index) => {
              const isUploadingAttachment = uploadingIdSet.has(attachment.id);
              const state = imageStates[attachment.id] || DEFAULT_IMAGE_STATE;
              const filename = attachment.filename || getDefaultFilename('image', index);
              if (state.error) {
                return (
                  <ImageErrorTile key={attachment.id} filename={filename} onRetry={handleRetry} />
                );
              }
              const canPreview = !isUploadingAttachment && !state.isLoading;
              return (
                <ThumbnailWrapper
                  key={attachment.id}
                  attachment={attachment}
                  filename={filename}
                  onDownload={handleDownload}
                  onPreview={canPreview ? () => setPreviewIndex(index) : undefined}
                >
                  <ImageThumbnail
                    filename={filename}
                    state={state}
                    isUploading={isUploadingAttachment}
                    size={size}
                  />
                </ThumbnailWrapper>
              );
            })}
          </div>
        )}
        {fileAttachments.length > 0 && (
          <div className={styles.list}>
            {fileAttachments.map((attachment, index) => (
              <FileAttachment
                key={attachment.id}
                attachment={attachment}
                index={index}
                isUploading={uploadingIdSet.has(attachment.id)}
                onDownload={handleDownload}
              />
            ))}
          </div>
        )}
      </div>
      <ImagePreviewModal
        isOpen={previewIndex !== null}
        onClose={handleClosePreview}
        attachments={imageAttachments}
        imageStates={imageStates}
        currentIndex={previewIndex ?? 0}
        onIndexChange={setPreviewIndex}
        onDownload={handleDownload}
        onRetry={handleRetry}
      />
    </>
  );
});
