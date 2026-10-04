import { FileUploadDialog } from '@/components/ui/FileUploadDialog/FileUploadDialog';
import { DrawingModal } from '@/components/ui/drawing-modal/DrawingModal';
import { DropIndicator } from './DropIndicator';
import { InputAttachments } from './InputAttachments';

interface ComposerAttachmentSlotsProps {
  isDragging: boolean;
  files: File[];
  previewUrls: string[];
  onRemoveFile: (index: number) => void;
  onEditImage: (index: number) => void;
  showFileUpload: boolean;
  onCloseFileUpload: () => void;
  onFileSelect: (files: File[]) => void;
  editingImageIndex: number | null;
  showDrawingModal: boolean;
  onCloseDrawing: () => void;
  onSaveDrawing: (dataUrl: string) => Promise<void>;
}

export function ComposerAttachmentSlots({
  isDragging,
  files,
  previewUrls,
  onRemoveFile,
  onEditImage,
  showFileUpload,
  onCloseFileUpload,
  onFileSelect,
  editingImageIndex,
  showDrawingModal,
  onCloseDrawing,
  onSaveDrawing,
}: ComposerAttachmentSlotsProps) {
  const editingUrl =
    editingImageIndex !== null && editingImageIndex < previewUrls.length
      ? previewUrls[editingImageIndex]
      : undefined;

  return (
    <>
      <DropIndicator visible={isDragging} fileType="any" message="Drop your files here" />
      <InputAttachments
        files={files}
        previewUrls={previewUrls}
        onRemoveFile={onRemoveFile}
        onEditImage={onEditImage}
      />
      <FileUploadDialog
        isOpen={showFileUpload}
        onClose={onCloseFileUpload}
        onFileSelect={onFileSelect}
      />
      {editingUrl && (
        <DrawingModal
          imageUrl={editingUrl}
          isOpen={showDrawingModal}
          onClose={onCloseDrawing}
          onSave={onSaveDrawing}
        />
      )}
    </>
  );
}
