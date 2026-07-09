import { memo } from 'react';
import { FileUploadDialog } from '@/components/ui/FileUploadDialog/FileUploadDialog';
import { DrawingModal } from '@/components/ui/drawing-modal/DrawingModal';
import { DropIndicator } from './DropIndicator';
import { SendButton } from './SendButton';
import type { SendButtonStatus } from './SendButton';
import { AttachButton } from './AttachButton';
import { EnhanceButton } from './EnhanceButton';
import { Textarea } from './Textarea';
import { InputControls } from './InputControls';
import { InputAttachments } from './InputAttachments';
import { SelectionAttachments } from './SelectionAttachments';
import { InputSuggestionsPanel } from './InputSuggestionsPanel';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { InputProvider } from './InputProvider';
import { useInputContext } from '@/hooks/useInputContext';
import type { ContextUsageInfo } from './ContextUsageIndicator';

export interface InputProps {
  message: string;
  setMessage: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onAttach?: (files: File[]) => void;
  attachedFiles?: File[] | null;
  isLoading: boolean;
  isStreaming?: boolean;
  onStopStream?: () => void;
  placeholder?: string;
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  dropdownPosition?: 'top' | 'bottom';
  showAttachedFilesPreview?: boolean;
  contextUsage?: ContextUsageInfo;
  showTip?: boolean;
  compact?: boolean;
  chatId?: string;
  showLoadingSpinner?: boolean;
  disabled?: boolean;
}

export const Input = memo(function Input(props: InputProps) {
  return (
    <InputProvider {...props}>
      <InputLayout />
    </InputProvider>
  );
});

function InputLayout() {
  const { state, actions, meta } = useInputContext();

  const shouldShowAttachedPreview =
    state.hasAttachments &&
    state.showPreview &&
    state.attachedFiles &&
    state.attachedFiles.length > 0;

  const sendStatus: SendButtonStatus = state.isStreaming
    ? state.hasContent
      ? 'ready'
      : 'streaming'
    : state.isLoading
      ? 'loading'
      : state.hasContent
        ? 'ready'
        : 'idle';

  return (
    <form ref={meta.formRef} onSubmit={actions.handleSubmit} className="relative px-4 sm:px-6">
      <div
        {...meta.dragHandlers}
        className={`relative rounded-2xl border bg-surface-secondary transition-[border-color] duration-300 dark:bg-surface-dark-secondary ${
          state.isDragging
            ? 'scale-[1.01] border-border-hover dark:border-border-dark-hover'
            : 'border-border dark:border-border-dark'
        }`}
      >
        <DropIndicator visible={state.isDragging} fileType="any" message="Drop your files here" />

        {shouldShowAttachedPreview && (
          <InputAttachments
            files={state.attachedFiles!}
            previewUrls={state.previewUrls}
            onRemoveFile={actions.handleRemoveFile}
            onEditImage={actions.handleDrawClick}
          />
        )}

        <SelectionAttachments
          selections={state.attachedSelections}
          onRemove={actions.handleRemoveSelection}
        />

        <div className="relative px-4 pt-2.5">
          <Textarea
            ref={meta.textareaRef}
            message={state.message}
            setMessage={actions.setMessage}
            placeholder={state.placeholder}
            isLoading={state.isLoading}
            disabled={state.isDisabled}
            onKeyDown={actions.handleKeyDown}
            onPaste={actions.handlePaste}
            onCursorPositionChange={actions.setCursorPosition}
            compact={state.compact}
          />
          <InputSuggestionsPanel />
        </div>

        <div className="flex items-center justify-end gap-0.5 px-2 pb-2 pt-0.5">
          <EnhanceButton
            onEnhance={actions.handleEnhancePrompt}
            isEnhancing={state.isEnhancing}
            disabled={state.isLoading || !state.hasMessage}
          />
          <AttachButton
            disabled={state.isDisabled}
            onAttach={() => {
              actions.resetDragState();
              actions.setShowFileUpload(true);
            }}
          />
          <SendButton
            status={sendStatus}
            disabled={sendStatus === 'idle' || state.isEnhancing || state.isDisabled}
            onClick={actions.handleSendClick}
            type="button"
            showLoadingSpinner={state.showLoadingSpinner}
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-2 pb-safe pt-1.5">
        <div className="flex-shrink-0">
          {state.contextUsage && <ContextUsageIndicator usage={state.contextUsage} />}
        </div>
        <InputControls />
      </div>

      <FileUploadDialog
        isOpen={state.showFileUpload}
        onClose={() => actions.setShowFileUpload(false)}
        onFileSelect={actions.handleFileSelect}
      />

      {state.editingImageIndex !== null &&
        state.editingImageIndex < state.previewUrls.length &&
        state.previewUrls[state.editingImageIndex] && (
          <DrawingModal
            imageUrl={state.previewUrls[state.editingImageIndex]}
            isOpen={state.showDrawingModal}
            onClose={actions.closeDrawingModal}
            onSave={actions.handleDrawingSave}
          />
        )}

      {state.showTip && !state.hasAttachments && (
        <div className="mt-1 animate-fade-in text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
          <span className="font-medium">Tip:</span> Drag and drop or paste images, pdfs and xlsx
          files into the input area, type `/` for slash commands, or `@` to mention files and agents
        </div>
      )}
    </form>
  );
}
