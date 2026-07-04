import { useCallback, useDeferredValue, useMemo, useRef } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import type { MentionItem } from '@/types/ui.types';
import { useSuggestionBase } from './useSuggestionBase';
import { traverseFileStructure, getFileName } from '@/utils/file';
import { parseTokenQuery } from '@/utils/mentionParser';
import { fuzzySearch } from '@/utils/fuzzySearch';

interface UseMentionOptions {
  message: string;
  cursorPosition: number;
  fileStructure: FileStructure[];
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

export const useMentionSuggestions = ({
  message,
  cursorPosition,
  fileStructure,
  onSelect,
}: UseMentionOptions) => {
  const allFiles = useMemo(() => convertFilesToMentions(fileStructure), [fileStructure]);

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

  const hasSuggestions = filteredFiles.length > 0;

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
    suggestions: filteredFiles,
    hasSuggestions,
    onSelect: handleSelect,
  });

  return {
    filteredFiles,
    highlightedIndex,
    hasSuggestions,
    selectItem,
    handleKeyDown,
    isActive,
  } as const;
};
