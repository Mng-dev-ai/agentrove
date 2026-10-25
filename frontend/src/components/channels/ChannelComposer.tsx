import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import toast from 'react-hot-toast';
import { queryClient } from '@/lib/queryClient';
import { AttachButton } from '@/components/chat/message-input/AttachButton';
import { ComposerAttachmentSlots } from '@/components/chat/message-input/ComposerAttachmentSlots';
import { ComposerField } from '@/components/chat/message-input/ComposerField';
import { EnhanceButton } from '@/components/chat/message-input/EnhanceButton';
import { SendButton, type SendButtonStatus } from '@/components/chat/message-input/SendButton';
import { MentionSuggestionsPanel } from '@/components/chat/message-input/MentionSuggestionsPanel';
import { Textarea } from '@/components/chat/message-input/Textarea';
import { useChatContext } from '@/hooks/useChatContext';
import { useInsertToken, useTokenDeleteKeyDown } from '@/hooks/useComposerTokens';
import { useMentionSuggestions } from '@/hooks/useMentionSuggestions';
import { useInputAttachments } from '@/hooks/useInputAttachments';
import { useInputEnhance } from '@/hooks/useInputEnhance';
import {
  usePostChannelMessageMutation,
  useStopChannelMutation,
} from '@/hooks/queries/useChannelQueries';
import { SelectionAttachments } from '@/components/chat/message-input/SelectionAttachments';
import { fetchAutoSteerQueuedMessages } from '@/hooks/queries/useSettingsQueries';
import { sendChannelQueuedMessageNow, useChannelQueueStore } from '@/store/messageQueueStore';
import { useUIStore, type ComposerSelection } from '@/store/uiStore';
import { formatComposerSelections } from '@/utils/composerSelections';
import type { Channel } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';

const NO_SELECTIONS: ComposerSelection[] = [];
const NO_CHATS: Chat[] = [];

interface ChannelComposerProps {
  channel: Channel;
  isBusy: boolean;
  onSend: () => void;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
}

export function ChannelComposer({
  channel,
  isBusy,
  onSend,
  draft,
  setDraft,
}: ChannelComposerProps) {
  const [files, setFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [cursorPosition, setCursorPosition] = useState(0);
  const { fileStructure } = useChatContext();
  const memberNames = useMemo(
    () => [...channel.members.map((member) => member.display_name), 'all'],
    [channel.members],
  );
  const insertTokenAt = useInsertToken(draftRef, setDraft, setCursorPosition, textareaRef);
  const handleTokenDeleteKeyDown = useTokenDeleteKeyDown(draftRef, textareaRef);
  const mentions = useMentionSuggestions({
    message: draft,
    cursorPosition,
    fileStructure,
    chats: NO_CHATS,
    members: memberNames,
    onSelect: (item, startPos, endPos) => insertTokenAt(`@${item.path}`, startPos, endPos),
  });

  const postMessage = usePostChannelMessageMutation();
  const stopChannel = useStopChannelMutation();
  const hasDraft = draft.trim().length > 0;
  // Diff comments and editor selections target the anchor chat's composer key.
  const selections = useUIStore(
    (state) => state.composerSelectionsByChat[channel.anchor_chat_id] ?? NO_SELECTIONS,
  );
  const canSend = hasDraft || selections.length > 0;

  const attachments = useInputAttachments({ attachedFiles: files, onAttach: setFiles });
  const { isEnhancing, handleEnhancePrompt } = useInputEnhance({
    setMessage: setDraft,
    textareaRef,
    selectedModelId: channel.members[0].model_id,
    messageRef: draftRef,
    hasMessage: hasDraft,
  });

  const handleSend = async () => {
    const text = draft.trim();
    if (!canSend || postMessage.isPending || isEnhancing) return;
    const content = formatComposerSelections(selections, text);
    const sentFiles = files;
    const sentSelections = selections;
    setDraft('');
    setFiles([]);
    useUIStore.getState().clearComposerSelections(channel.anchor_chat_id);
    onSend();
    try {
      if (isBusy) {
        const messageId = await useChannelQueueStore
          .getState()
          .queueMessage(channel.id, content, sentFiles);
        if (await fetchAutoSteerQueuedMessages(queryClient)) {
          await sendChannelQueuedMessageNow(channel.id, messageId);
        }
        // The send event can beat the enqueue response and miss the temp id.
        void useChannelQueueStore.getState().fetchQueue(channel.id);
      } else {
        await postMessage.mutateAsync({ channelId: channel.id, content, files: sentFiles });
      }
    } catch (error) {
      setDraft((current) => (current ? `${text}\n${current}` : text));
      setFiles((current) => [...sentFiles, ...current]);
      sentSelections.forEach((selection) =>
        useUIStore.getState().addComposerSelection(channel.anchor_chat_id, selection),
      );
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    }
  };

  const handleStop = () => {
    stopChannel.mutate(channel.id, {
      onError: (error) => toast.error(error.message || 'Failed to stop'),
    });
  };

  const sendStatus: SendButtonStatus = canSend
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
        <>
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
          <SelectionAttachments
            selections={selections}
            onRemove={(index) =>
              useUIStore.getState().removeComposerSelection(channel.anchor_chat_id, index)
            }
          />
        </>
      }
      textarea={
        <>
          <Textarea
            ref={textareaRef}
            message={draft}
            setMessage={setDraft}
            placeholder={`Message #${channel.name}`}
            isLoading={postMessage.isPending}
            onPaste={attachments.handlePaste}
            onCursorPositionChange={setCursorPosition}
            onKeyDown={(e) => {
              if (mentions.handleKeyDown(e) || handleTokenDeleteKeyDown(e)) return;
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          {mentions.isActive && (
            <MentionSuggestionsPanel
              members={mentions.filteredMembers}
              files={mentions.filteredFiles}
              chats={mentions.filteredChats}
              highlightedIndex={mentions.highlightedIndex}
              onSelect={mentions.selectItem}
            />
          )}
        </>
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
            onClick={canSend ? () => void handleSend() : handleStop}
          />
        </>
      }
    />
  );
}
