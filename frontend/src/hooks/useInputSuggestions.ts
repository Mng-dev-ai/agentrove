import { useCallback, type RefObject } from 'react';
import { useSlashCommandSuggestions } from '@/hooks/useSlashCommandSuggestions';
import { useMentionSuggestions } from '@/hooks/useMentionSuggestions';
import { useInsertToken } from '@/hooks/useComposerTokens';
import type { MentionItem, SlashCommand } from '@/types/ui.types';
import type { AgentKind, Chat } from '@/types/chat.types';
import type { FileStructure } from '@/types/file-system.types';

interface UseInputSuggestionsOptions {
  message: string;
  cursorPosition: number;
  setMessage: (value: string) => void;
  setCursorPosition: (pos: number) => void;
  messageRef: RefObject<string>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileStructure: FileStructure[];
  mentionChats: Chat[];
  chatId?: string;
  builtinSlashCommands: Record<AgentKind, SlashCommand[]>;
  agentKind: AgentKind;
}

export function useInputSuggestions({
  message,
  cursorPosition,
  setMessage,
  setCursorPosition,
  messageRef,
  textareaRef,
  fileStructure,
  mentionChats,
  chatId,
  builtinSlashCommands,
  agentKind,
}: UseInputSuggestionsOptions) {
  const insertTokenAt = useInsertToken(messageRef, setMessage, setCursorPosition, textareaRef);

  const handleSlashCommandSelect = useCallback(
    (command: SlashCommand, startPos: number, endPos: number) => {
      insertTokenAt(command.value, startPos, endPos);
    },
    [insertTokenAt],
  );

  const {
    filteredCommands: slashCommandSuggestions,
    highlightedIndex: highlightedSlashCommandIndex,
    selectCommand: selectSlashCommand,
    handleKeyDown: handleSlashCommandKeyDown,
  } = useSlashCommandSuggestions({
    message,
    cursorPosition,
    onSelect: handleSlashCommandSelect,
    builtinSlashCommands,
    agentKind,
  });

  const handleMentionSelect = useCallback(
    (item: MentionItem, mentionStartPos: number, mentionEndPos: number) => {
      insertTokenAt(`@${item.path}`, mentionStartPos, mentionEndPos);
    },
    [insertTokenAt],
  );

  const {
    filteredFiles,
    filteredChats,
    highlightedIndex: highlightedMentionIndex,
    selectItem: selectMention,
    handleKeyDown: handleMentionKeyDown,
    isActive: isMentionActive,
  } = useMentionSuggestions({
    message,
    cursorPosition: cursorPosition,
    fileStructure,
    chats: mentionChats,
    currentChatId: chatId,
    onSelect: handleMentionSelect,
  });

  return {
    slashCommandSuggestions,
    highlightedSlashCommandIndex,
    selectSlashCommand,
    handleSlashCommandKeyDown,
    filteredFiles,
    filteredChats,
    highlightedMentionIndex,
    selectMention,
    handleMentionKeyDown,
    isMentionActive,
  };
}
