import { useCallback, type RefObject } from 'react';
import { useSlashCommandSuggestions } from '@/hooks/useSlashCommandSuggestions';
import { useMentionSuggestions } from '@/hooks/useMentionSuggestions';
import { insertToken } from '@/utils/mentionParser';
import type { MentionItem, SlashCommand } from '@/types/ui.types';
import type { CustomSkill } from '@/types/user.types';
import type { AgentKind } from '@/types/chat.types';
import type { FileStructure } from '@/types/file-system.types';

interface UseInputSuggestionsOptions {
  message: string;
  cursorPosition: number;
  setMessage: (value: string) => void;
  setCursorPosition: (pos: number) => void;
  messageRef: RefObject<string>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileStructure: FileStructure[];
  customSkills: CustomSkill[];
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
  customSkills,
  builtinSlashCommands,
  agentKind,
}: UseInputSuggestionsOptions) {
  const insertTokenAt = useCallback(
    (tokenText: string, startPos: number, endPos: number) => {
      const { text, cursor } = insertToken(messageRef.current, tokenText, startPos, endPos);

      setMessage(text);

      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(cursor, cursor);
          setCursorPosition(cursor);
        }
      }, 0);
    },
    [setMessage],
  );

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
    customSkills,
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
    highlightedIndex: highlightedMentionIndex,
    selectItem: selectMention,
    handleKeyDown: handleMentionKeyDown,
    isActive: isMentionActive,
  } = useMentionSuggestions({
    message,
    cursorPosition: cursorPosition,
    fileStructure,
    onSelect: handleMentionSelect,
  });

  return {
    slashCommandSuggestions,
    highlightedSlashCommandIndex,
    selectSlashCommand,
    handleSlashCommandKeyDown,
    filteredFiles,
    highlightedMentionIndex,
    selectMention,
    handleMentionKeyDown,
    isMentionActive,
  };
}
