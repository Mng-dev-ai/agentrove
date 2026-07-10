import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { logger } from '@/utils/logger';
import type { MessageAttachment } from '@/types/chat.types';
import { resolveChatClient } from '@/lib/api';
import { fetchAttachmentBlob, downloadAttachmentFile } from '@/utils/file';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import { ImagePreviewModal } from '../ImagePreviewModal/ImagePreviewModal';
import {
  ThumbnailWrapper,
  IconThumbnail,
  ImageThumbnail,
  type ImageState,
} from './AttachmentThumbnails';
import styles from './AttachmentViewer.module.scss';

interface AttachmentViewerProps {
  attachments: MessageAttachment[];
  uploadingAttachmentIds?: string[];
  // Routes attachment fetch/download to the chat's backend — cloud messages carry
  // relative /api/v1/attachments URLs that only resolve on the owning VPS.
  chatId?: string;
}

const DEFAULT_IMAGE_STATE: ImageState = { isLoading: true, error: false, imageSrc: '' };

export const AttachmentViewer = memo(function AttachmentViewer({
  attachments,
  uploadingAttachmentIds,
  chatId,
}: AttachmentViewerProps) {
  const [imageStates, setImageStates] = useState<Record<string, ImageState>>({});
  // Index into imageAttachments of the image currently shown in the lightbox; null means closed.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const ownedObjectUrlsRef = useRef<Set<string>>(new Set());
  const uploadingIdSet = useMemo(
    () => new Set(uploadingAttachmentIds ?? []),
    [uploadingAttachmentIds],
  );

  const handleDownload = useCallback(
    async (url: string, fileName: string) => {
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
  const imageIndexMap = useMemo(
    () => new Map(imageAttachments.map((a, i) => [a.id, i])),
    [imageAttachments],
  );
  const imageIdKey = useMemo(
    () => imageAttachments.map((a) => a.id).join('\0'),
    [imageAttachments],
  );

  const handleClosePreview = useCallback(() => setPreviewIndex(null), []);

  useEffect(() => {
    if (imageAttachments.length === 0) return;

    const loadedIds = loadedIdsRef.current;
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
          if (isBrowserObjectUrl(attachment.file_url)) {
            if (!cancelled) {
              completedIds.add(key);
              setImageStates((prev) => ({
                ...prev,
                [key]: { isLoading: false, error: false, imageSrc: attachment.file_url },
              }));
            }
            return;
          }

          const blob = await fetchAttachmentBlob(attachment.file_url, resolveChatClient(chatId));
          if (cancelled) return;
          const blobUrl = URL.createObjectURL(blob);
          ownedObjectUrlsRef.current.add(blobUrl);
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
  }, [imageIdKey]);

  useEffect(() => {
    const loadedIds = loadedIdsRef.current;
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    return () => {
      ownedObjectUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      ownedObjectUrls.clear();
      loadedIds.clear();
      setImageStates({});
    };
  }, []);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      <div className={styles.list}>
        {attachments.map((attachment, index) => {
          const isUploadingAttachment = uploadingIdSet.has(attachment.id);

          if (attachment.file_type === 'image') {
            const state = imageStates[attachment.id] || DEFAULT_IMAGE_STATE;
            // Preview is only meaningful once the image has finished loading successfully —
            // don't open the lightbox on a still-loading or errored thumbnail.
            const canPreview = !isUploadingAttachment && !state.isLoading && !state.error;
            // Safe non-null: every 'image' attachment is in imageAttachments, so the map always has it.
            const imageIndex = imageIndexMap.get(attachment.id)!;

            return (
              <ThumbnailWrapper
                key={attachment.id}
                attachment={attachment}
                onDownload={handleDownload}
                onPreview={canPreview ? () => setPreviewIndex(imageIndex) : undefined}
              >
                <ImageThumbnail
                  attachment={attachment}
                  state={state}
                  index={index}
                  isUploading={isUploadingAttachment}
                />
              </ThumbnailWrapper>
            );
          }

          if (attachment.file_type === 'pdf' || attachment.file_type === 'xlsx') {
            return (
              <ThumbnailWrapper
                key={attachment.id}
                attachment={attachment}
                onDownload={handleDownload}
              >
                <IconThumbnail attachment={attachment} isLoading={isUploadingAttachment} />
              </ThumbnailWrapper>
            );
          }

          return null;
        })}
      </div>
      <ImagePreviewModal
        isOpen={previewIndex !== null}
        onClose={handleClosePreview}
        attachments={imageAttachments}
        imageStates={imageStates}
        currentIndex={previewIndex ?? 0}
        onIndexChange={setPreviewIndex}
        onDownload={handleDownload}
      />
    </>
  );
});
