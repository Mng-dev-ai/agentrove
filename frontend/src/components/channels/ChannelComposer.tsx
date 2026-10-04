import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AttachButton } from '@/components/chat/message-input/AttachButton';
import { ComposerAttachmentSlots } from '@/components/chat/message-input/ComposerAttachmentSlots';
import { ComposerField } from '@/components/chat/message-input/ComposerField';
import { EnhanceButton } from '@/components/chat/message-input/EnhanceButton';
import { SendButton, type SendButtonStatus } from '@/components/chat/message-input/SendButton';
import { Textarea } from '@/components/chat/message-input/Textarea';
import { useInputAttachments } from '@/hooks/useInputAttachments';
import { useInputEnhance } from '@/hooks/useInputEnhance';
import {
  usePostChannelMessageMutation,
  useStopChannelMutation,
} from '@/hooks/queries/useChannelQueries';
import type { Channel } from '@/types/channel.types';

interface ChannelComposerProps {
  channel: Channel;
  isBusy: boolean;
  onSend: () => void;
}

export function ChannelComposer({ channel, isBusy, onSend }: ChannelComposerProps) {
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const postMessage = usePostChannelMessageMutation();
  const stopChannel = useStopChannelMutation();
  const hasDraft = draft.trim().length > 0;

  const attachments = useInputAttachments({ attachedFiles: files, onAttach: setFiles });
  const { isEnhancing, handleEnhancePrompt } = useInputEnhance({
    setMessage: setDraft,
    textareaRef,
    selectedModelId: channel.members[0].model_id,
    messageRef: draftRef,
    hasMessage: hasDraft,
  });

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || postMessage.isPending || isEnhancing) return;
    const sentFiles = files;
    setDraft('');
    setFiles([]);
    onSend();
    try {
      await postMessage.mutateAsync({ channelId: channel.id, content, files: sentFiles });
    } catch (error) {
      setDraft((current) => (current ? `${content}\n${current}` : content));
      setFiles((current) => [...sentFiles, ...current]);
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    }
  };

  const handleStop = () => {
    stopChannel.mutate(channel.id, {
      onError: (error) => toast.error(error.message || 'Failed to stop'),
    });
  };

  const sendStatus: SendButtonStatus = hasDraft
    ? 'ready'
    : isBusy
      ? 'streaming'
      : postMessage.isPending
        ? 'loading'
        : 'idle';

  return (
    <ComposerField
      onSubmit={(e) => {
        e.preventDefault();
        void handleSend();
      }}
      isDragging={attachments.isDragging}
      dragHandlers={attachments.dragHandlers}
      attachments={
        <ComposerAttachmentSlots
          isDragging={attachments.isDragging}
          files={files}
          previewUrls={attachments.previewUrls}
          onRemoveFile={attachments.handleRemoveFile}
          onEditImage={attachments.handleDrawClick}
          showFileUpload={attachments.showFileUpload}
          onCloseFileUpload={() => attachments.setShowFileUpload(false)}
          onFileSelect={attachments.handleFileSelect}
          editingImageIndex={attachments.editingImageIndex}
          showDrawingModal={attachments.showDrawingModal}
          onCloseDrawing={attachments.closeDrawingModal}
          onSaveDrawing={attachments.handleDrawingSave}
        />
      }
      textarea={
        <Textarea
          ref={textareaRef}
          message={draft}
          setMessage={setDraft}
          placeholder={`Message #${channel.name}`}
          isLoading={postMessage.isPending}
          onPaste={attachments.handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
      }
      actions={
        <>
          <EnhanceButton
            onEnhance={handleEnhancePrompt}
            isEnhancing={isEnhancing}
            disabled={postMessage.isPending || !hasDraft}
          />
          <AttachButton
            onAttach={() => {
              attachments.resetDragState();
              attachments.setShowFileUpload(true);
            }}
          />
          <SendButton
            status={sendStatus}
            disabled={
              sendStatus === 'idle' ||
              sendStatus === 'loading' ||
              isEnhancing ||
              (sendStatus === 'streaming' && stopChannel.isPending)
            }
            onClick={hasDraft ? () => void handleSend() : handleStop}
          />
        </>
      }
    />
  );
}
