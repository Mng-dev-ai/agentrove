import { useCallback, useMemo, useRef } from 'react';
import { useSuggestionBase } from './useSuggestionBase';
import { parseTokenQuery } from '@/utils/mentionParser';
import type { SlashCommand } from '@/types/ui.types';
import type { CustomSkill } from '@/types/user.types';
import type { AgentKind } from '@/types/chat.types';

interface UseSlashCommandOptions {
  message: string;
  cursorPosition: number;
  onSelect: (command: SlashCommand, commandStartPos: number, commandEndPos: number) => void;
  customSkills: CustomSkill[];
  builtinSlashCommands: Record<AgentKind, SlashCommand[]>;
  agentKind: AgentKind;
}

export const useSlashCommandSuggestions = ({
  message,
  cursorPosition,
  onSelect,
  customSkills,
  builtinSlashCommands,
  agentKind,
}: UseSlashCommandOptions) => {
  const allCommands = useMemo(() => {
    const builtins = builtinSlashCommands[agentKind];

    const skillCommands: SlashCommand[] = customSkills
      .filter((skill) => skill.sources.includes(agentKind))
      .map((skill) => ({
        value: `/${skill.name}`,
        label: skill.name,
        description: skill.description,
      }));

    return [...builtins, ...skillCommands];
  }, [builtinSlashCommands, agentKind, customSkills]);

  const { isActive, query, tokenStartPos, tokenEndPos } = parseTokenQuery(
    message,
    cursorPosition,
    '/',
  );

  const filteredCommands = useMemo(() => {
    if (!isActive) return [];
    if (!query) return allCommands;
    return allCommands.filter((command) => command.value.slice(1).toLowerCase().startsWith(query));
  }, [isActive, query, allCommands]);

  const hasSuggestions = filteredCommands.length > 0;

  const tokenStartPosRef = useRef(tokenStartPos);
  tokenStartPosRef.current = tokenStartPos;
  const tokenEndPosRef = useRef(tokenEndPos);
  tokenEndPosRef.current = tokenEndPos;

  const handleSelect = useCallback(
    (command: SlashCommand) => {
      if (tokenStartPosRef.current === -1) return;
      onSelect(command, tokenStartPosRef.current, tokenEndPosRef.current);
    },
    [onSelect],
  );

  const { highlightedIndex, selectItem, handleKeyDown } = useSuggestionBase({
    suggestions: filteredCommands,
    hasSuggestions,
    onSelect: handleSelect,
  });

  return {
    filteredCommands,
    highlightedIndex,
    hasSuggestions,
    selectCommand: selectItem,
    handleKeyDown,
  } as const;
};
