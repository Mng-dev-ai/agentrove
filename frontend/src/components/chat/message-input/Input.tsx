import { memo, type Dispatch, type SetStateAction } from 'react';
import { SendButton } from './SendButton';
import type { SendButtonStatus } from './SendButton';
import { AttachButton } from './AttachButton';
import { EnhanceButton } from './EnhanceButton';
import { Textarea } from './Textarea';
import { ComposerFooter, ModelControls } from './InputControls';
import { ComposerField } from './ComposerField';
import { ComposerAttachmentSlots } from './ComposerAttachmentSlots';
import { SelectionAttachments } from './SelectionAttachments';
import { InputSuggestionsPanel } from './InputSuggestionsPanel';
import { InputProvider } from './InputProvider';
import { useInputContext } from '@/hooks/useInputContext';
import type { ContextUsageInfo } from '@/utils/contextUsage';
import type { DropdownPosition } from '@/components/ui/primitives/Dropdown/Dropdown';

export interface InputProps {
  message: string;
  setMessage: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onAttach?: Dispatch<SetStateAction<File[]>>;
  attachedFiles?: File[] | null;
  isLoading: boolean;
  isStreaming?: boolean;
  onStopStream?: () => void;
  placeholder?: string;
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  dropdownPosition?: DropdownPosition;
  showAttachedFilesPreview?: boolean;
  contextUsage?: ContextUsageInfo;
  // Landing hosts branch selection in its own composer control, so its footer hides it.
  showBranch?: boolean;
  // Text on its own row above the controls even when it would fit beside them
  stacked?: boolean;
  chatId?: string;
  machineId?: string;
  showLoadingSpinner?: boolean;
  disabled?: boolean;
}

export const Input = memo(function Input(props: InputProps) {
  return (
    <InputProvider {...props}>
      <InputLayout stacked={props.stacked} />
    </InputProvider>
  );
});

function InputLayout({ stacked }: { stacked?: boolean }) {
  const { state, actions, meta } = useInputContext();

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
    <ComposerField
      ref={meta.formRef}
      stacked={stacked}
      onSubmit={actions.handleSubmit}
      message={state.message}
      placeholders={state.placeholders}
      isDragging={state.isDragging}
      dragHandlers={meta.dragHandlers}
      attachments={
        <>
          <ComposerAttachmentSlots
            machineId={state.machineId}
            isDragging={state.isDragging}
            files={state.showPreview && state.attachedFiles ? state.attachedFiles : []}
            previewUrls={state.previewUrls}
            onRemoveFile={actions.handleRemoveFile}
            onEditImage={actions.handleDrawClick}
            showFileUpload={state.showFileUpload}
            onCloseFileUpload={() => actions.setShowFileUpload(false)}
            onFileSelect={actions.handleFileSelect}
            editingImageIndex={state.editingImageIndex}
            showDrawingModal={state.showDrawingModal}
            onCloseDrawing={actions.closeDrawingModal}
            onSaveDrawing={actions.handleDrawingSave}
          />

          <SelectionAttachments
            selections={state.attachedSelections}
            onRemove={actions.handleRemoveSelection}
          />
        </>
      }
      leading={
        <AttachButton
          disabled={state.isDisabled}
          onAttach={() => {
            actions.resetDragState();
            actions.setShowFileUpload(true);
          }}
        />
      }
      textarea={(placeholder) => (
        <>
          <Textarea
            ref={meta.textareaRef}
            message={state.message}
            setMessage={actions.setMessage}
            placeholder={placeholder}
            isLoading={state.isLoading}
            disabled={state.isDisabled}
            onKeyDown={actions.handleKeyDown}
            onPaste={actions.handlePaste}
            onCursorPositionChange={actions.setCursorPosition}
          />
          <InputSuggestionsPanel />
        </>
      )}
      trailing={
        <>
          {state.hasMessage && (
            <EnhanceButton
              onEnhance={actions.handleEnhancePrompt}
              isEnhancing={state.isEnhancing}
              disabled={state.isLoading}
            />
          )}
          <ModelControls />
          <SendButton
            status={sendStatus}
            disabled={sendStatus === 'idle' || state.isEnhancing || state.isDisabled}
            onClick={actions.handleSendClick}
            type="button"
            showLoadingSpinner={state.showLoadingSpinner}
          />
        </>
      }
    >
      <ComposerFooter />
    </ComposerField>
  );
}
