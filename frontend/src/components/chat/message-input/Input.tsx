import { memo, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { stateClasses } from '@/config/stateClasses';
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
import { useOverflowCompact } from '@/hooks/useOverflowCompact';
import type { ContextUsageInfo } from './ContextUsageIndicator';
import styles from './Input.module.scss';

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
  // Extra selectors rendered on the left of the footer row (landing page's
  // workspace/worktree/run-location pickers); chats leave this empty.
  footerLeading?: ReactNode;
}

export const Input = memo(function Input(props: InputProps) {
  return (
    <InputProvider {...props}>
      <InputLayout footerLeading={props.footerLeading} />
    </InputProvider>
  );
});

function InputLayout({ footerLeading }: { footerLeading?: ReactNode }) {
  const { state, actions, meta } = useInputContext();
  // Collapses the footer's labels to icons when the labeled row would wrap.
  const footerRowRef = useRef<HTMLDivElement>(null);
  const isFooterCompact = useOverflowCompact(footerRowRef);

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
    <form ref={meta.formRef} onSubmit={actions.handleSubmit} className={styles.input}>
      <div
        {...meta.dragHandlers}
        className={clsx(styles.field, state.isDragging && stateClasses.DRAGGING)}
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

        <div className={styles['textarea-wrap']}>
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

        <div className={styles.actions}>
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

      <div
        ref={footerRowRef}
        className={clsx(styles['footer-row'], isFooterCompact && stateClasses.COMPACT)}
      >
        <div className={styles['footer-leading']}>
          {footerLeading}
          <div className={styles['context-slot']}>
            {state.contextUsage && <ContextUsageIndicator usage={state.contextUsage} />}
          </div>
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
        <div className={styles.tip}>
          <span className={styles['tip-label']}>Tip:</span> Drag and drop or paste images, pdfs and
          xlsx files into the input area, type `/` for slash commands, or `@` to mention files and
          agents
        </div>
      )}
    </form>
  );
}
