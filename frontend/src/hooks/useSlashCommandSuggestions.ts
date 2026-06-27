import { useMemo } from 'react';
import { useSuggestionBase } from './useSuggestionBase';
import type { SlashCommand } from '@/types/ui.types';
import type { CustomSkill } from '@/types/user.types';
import type { AgentKind } from '@/types/chat.types';

interface UseSlashCommandOptions {
  message: string;
  onSelect: (command: SlashCommand) => void;
  customSkills: CustomSkill[];
  builtinSlashCommands: Record<AgentKind, SlashCommand[]>;
  agentKind: AgentKind;
}

export const useSlashCommandSuggestions = ({
  message,
  onSelect,
  customSkills,
  builtinSlashCommands,
  agentKind,
}: UseSlashCommandOptions) => {
  const allCommands = useMemo(() => {
    const builtins = builtinSlashCommands[agentKind];

    // Custom skills filtered to match the active agent kind
    const skillCommands: SlashCommand[] = customSkills
      .filter((skill) => skill.sources.includes(agentKind))
      .map((skill) => ({
        value: `/${skill.name}`,
        label: skill.name,
        description: skill.description,
      }));

    return [...builtins, ...skillCommands];
  }, [builtinSlashCommands, agentKind, customSkills]);

  const { isActive, query } = useMemo(() => {
    const firstLine = message.split('\n', 1)[0];
    const trimmedFirstLine = firstLine.trimStart();

    if (trimmedFirstLine.startsWith('/') && !trimmedFirstLine.includes(' ')) {
      return {
        isActive: true,
        query: trimmedFirstLine.slice(1).toLowerCase(),
      } as const;
    }

    return { isActive: false, query: '' } as const;
  }, [message]);

  const filteredCommands = useMemo(() => {
    if (!isActive) return [];
    if (!query) return allCommands;
    return allCommands.filter((command) => command.value.slice(1).toLowerCase().startsWith(query));
  }, [isActive, query, allCommands]);

  const hasSuggestions = filteredCommands.length > 0;

  const { highlightedIndex, selectItem, handleKeyDown } = useSuggestionBase({
    suggestions: filteredCommands,
    hasSuggestions,
    onSelect,
  });

  return {
    filteredCommands,
    highlightedIndex,
    hasSuggestions,
    selectCommand: selectItem,
    handleKeyDown,
  } as const;
};
