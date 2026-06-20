import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileText, FileSpreadsheet, Download } from 'lucide-react';
import { logger } from '@/utils/logger';
import type { MessageAttachment } from '@/types/chat.types';
import { Button } from './primitives/Button';
import { Spinner } from './primitives/Spinner';
import { cn } from '@/utils/cn';
import { resolveChatClient } from '@/lib/api';
import { fetchAttachmentBlob, downloadAttachmentFile } from '@/utils/file';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import { ImagePreviewModal } from './ImagePreviewModal';

interface AttachmentViewerProps {
  attachments: MessageAttachment[];
  uploadingAttachmentIds?: string[];
  // Routes attachment fetch/download to the chat's backend — cloud messages carry
  // relative /api/v1/attachments URLs that only resolve on the owning VPS.
  chatId?: string;
}

interface ImageState {
  isLoading: boolean;
  error: boolean;
  imageSrc: string;
}

interface ThumbnailWrapperProps {
  attachment: MessageAttachment;
  onDownload: (url: string, filename: string) => void;
  onPreview?: () => void;
  children: ReactNode;
}

interface IconConfig {
  icon: LucideIcon;
  color: string;
  label: string;
}

const getFileExtension = (filename?: string): string => {
  return filename?.split('.').pop()?.toUpperCase() || '';
};

const getIconConfig = (fileType: string, filename?: string): IconConfig => {
  if (fileType === 'pdf') {
    return {
      icon: FileText,
      color: 'text-error-500 dark:text-error-400',
      label: 'PDF',
    };
  }

  if (fileType === 'xlsx') {
    return {
      icon: FileSpreadsheet,
      color: 'text-success-600 dark:text-success-400',
      label: getFileExtension(filename) || 'XLSX',
    };
  }

  return {
    icon: FileText,
    color: 'text-text-tertiary dark:text-text-dark-tertiary',
    label: 'FILE',
  };
};

const getDefaultFilename = (fileType: string, index: number): string => {
  switch (fileType) {
    case 'pdf':
      return 'document.pdf';
    case 'xlsx':
      return 'spreadsheet.xlsx';
    case 'image':
      return `image-${index}.jpg`;
    default:
      return `file-${index}`;
  }
};

const LoadingProgressOverlay = memo(function LoadingProgressOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 rounded bg-black/35">
      <div className="absolute inset-0 flex items-center justify-center">
        <Spinner size="xs" className="text-white" />
      </div>
    </div>
  );
});

const downloadButtonClass =
  'h-5 w-5 rounded-full bg-black/60 text-white shadow-md backdrop-blur-sm hover:bg-black/70 focus-visible:ring-white/70';

const DEFAULT_IMAGE_STATE: ImageState = { isLoading: true, error: false, imageSrc: '' };

function ThumbnailWrapper({ attachment, onDownload, onPreview, children }: ThumbnailWrapperProps) {
  const filename = attachment.filename || getDefaultFilename(attachment.file_type, 0);
  const isInteractive = Boolean(onPreview);

  return (
    <div
      className={cn(
        'group/thumbnail relative rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-quaternary/30',
        isInteractive && 'cursor-zoom-in',
      )}
      onClick={onPreview}
      onKeyDown={
        isInteractive
          ? (e) => {
              // Only react to keys on the wrapper itself — avoid double-firing when the nested
              // download button is focused and the user presses Enter/Space on it.
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPreview?.();
              }
            }
          : undefined
      }
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `Preview ${filename}` : undefined}
    >
      {children}
      <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/thumbnail:opacity-100">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={(e) => {
            // Stop propagation so the wrapper's preview click handler (images) doesn't fire.
            e.stopPropagation();
            onDownload(attachment.file_url, filename);
          }}
          className={cn('p-0', downloadButtonClass)}
          aria-label={`Download ${attachment.file_type}`}
        >
          <Download className="h-2.5 w-2.5 text-white" />
        </Button>
      </div>
    </div>
  );
}

function IconThumbnail({
  attachment,
  isLoading = false,
}: {
  attachment: MessageAttachment;
  isLoading?: boolean;
}) {
  const { icon: Icon, color, label } = getIconConfig(attachment.file_type, attachment.filename);

  return (
    <div className="relative flex h-10 w-10 flex-col items-center justify-center rounded border border-border/50 bg-surface-secondary transition-colors hover:bg-surface-hover dark:border-border-dark/50 dark:bg-surface-dark-secondary dark:hover:bg-surface-dark-hover">
      <Icon className={`h-4 w-4 ${color}`} />
      <p className="text-[8px] leading-tight text-text-tertiary dark:text-text-dark-tertiary">
        {label}
      </p>
      {isLoading && <LoadingProgressOverlay />}
    </div>
  );
}

function ImageThumbnail({
  attachment,
  state,
  index,
  isUploading = false,
}: {
  attachment: MessageAttachment;
  state: ImageState;
  index: number;
  isUploading?: boolean;
}) {
  const filename = attachment.filename || getDefaultFilename('image', index);

  if (state.isLoading) {
    return (
      <div className="relative h-10 w-10 rounded bg-surface-secondary dark:bg-surface-dark-secondary">
        <LoadingProgressOverlay />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded border border-border/50 bg-surface-secondary dark:border-border-dark/50 dark:bg-surface-dark-secondary">
        <p className="text-[8px] text-text-tertiary dark:text-text-dark-tertiary">Error</p>
      </div>
    );
  }

  if (state.imageSrc) {
    return (
      <div className="relative inline-block">
        <img
          src={state.imageSrc}
          alt={filename}
          className="block h-10 w-10 rounded object-cover"
          loading="lazy"
        />
        {isUploading && <LoadingProgressOverlay />}
      </div>
    );
  }

  return null;
}

function AttachmentViewerInner({
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
      <div className="flex flex-wrap gap-1.5">
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
}

export const AttachmentViewer = memo(AttachmentViewerInner);
