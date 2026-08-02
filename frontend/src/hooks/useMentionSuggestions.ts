import { useCallback, useDeferredValue, useMemo, useRef } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import type { Chat } from '@/types/chat.types';
import type { MentionItem } from '@/types/ui.types';
import { useSuggestionBase } from './useSuggestionBase';
import { traverseFileStructure, getFileName } from '@/utils/file';
import { parseTokenQuery } from '@/utils/mentionParser';
import { fuzzySearch } from '@/utils/fuzzySearch';

const CHAT_SUGGESTION_LIMIT = 10;

interface UseMentionOptions {
  message: string;
  cursorPosition: number;
  fileStructure: FileStructure[];
  chats: Chat[];
  currentChatId?: string;
  onSelect: (item: MentionItem, mentionStartPos: number, mentionEndPos: number) => void;
}

const convertFilesToMentions = (files: FileStructure[]): MentionItem[] => {
  return traverseFileStructure(files, (item) => {
    if (item.type === 'file') {
      return {
        type: 'file' as const,
        name: getFileName(item.path),
        path: item.path,
      };
    }
    return null;
  });
};

// `path` doubles as the inserted token body — `@chat:<id>` is resolved by the
// agent via the agentrove MCP, so no chat content is inlined here.
const convertChatsToMentions = (chats: Chat[], currentChatId?: string): MentionItem[] =>
  chats
    .filter((chat) => chat.id !== currentChatId)
    .map((chat) => ({
      type: 'chat' as const,
      name: chat.title,
      path: `chat:${chat.id}`,
    }));

export const useMentionSuggestions = ({
  message,
  cursorPosition,
  fileStructure,
  chats,
  currentChatId,
  onSelect,
}: UseMentionOptions) => {
  const allFiles = useMemo(() => convertFilesToMentions(fileStructure), [fileStructure]);
  const allChats = useMemo(
    () => convertChatsToMentions(chats, currentChatId),
    [chats, currentChatId],
  );

  const {
    isActive,
    query,
    tokenStartPos: mentionStartPos,
    tokenEndPos: mentionEndPos,
  } = parseTokenQuery(message, cursorPosition, '@');

  const deferredQuery = useDeferredValue(query);

  const filteredFiles = useMemo(() => {
    if (!isActive) {
      return [];
    }
    return fuzzySearch(deferredQuery, allFiles, { keys: ['name', 'path'], limit: 30 });
  }, [isActive, deferredQuery, allFiles]);

  const filteredChats = useMemo(() => {
    if (!isActive) {
      return [];
    }
    return fuzzySearch(deferredQuery, allChats, { keys: ['name'], limit: CHAT_SUGGESTION_LIMIT });
  }, [isActive, deferredQuery, allChats]);

  // Order must match the panel's sections — the keyboard index is global across both.
  const suggestions = useMemo(
    () => [...filteredFiles, ...filteredChats],
    [filteredFiles, filteredChats],
  );

  const hasSuggestions = suggestions.length > 0;

  const mentionStartPosRef = useRef(mentionStartPos);
  mentionStartPosRef.current = mentionStartPos;
  const mentionEndPosRef = useRef(mentionEndPos);
  mentionEndPosRef.current = mentionEndPos;

  const handleSelect = useCallback(
    (item: MentionItem) => {
      if (mentionStartPosRef.current === -1) return;
      onSelect(item, mentionStartPosRef.current, mentionEndPosRef.current);
    },
    [onSelect],
  );

  const { highlightedIndex, selectItem, handleKeyDown } = useSuggestionBase({
    suggestions,
    hasSuggestions,
    onSelect: handleSelect,
  });

  return {
    filteredFiles,
    filteredChats,
    highlightedIndex,
    hasSuggestions,
    selectItem,
    handleKeyDown,
    isActive,
  } as const;
};
