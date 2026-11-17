import { memo, useMemo } from 'react';
import { SuggestionPanel } from './SuggestionPanel';
import type { SlashCommand } from '@/types/ui.types';

interface SlashCommandsPanelProps {
  suggestions: SlashCommand[];
  highlightedIndex: number;
  onSelect: (command: SlashCommand) => void;
}

const getCommandRow = (command: SlashCommand) => ({
  label: command.value,
  detail: command.description,
});

const commandItemKey = (command: SlashCommand) => command.value;

export const SlashCommandsPanel = memo(function SlashCommandsPanel({
  suggestions,
  highlightedIndex,
  onSelect,
}: SlashCommandsPanelProps) {
  const sections = useMemo(
    () => [
      {
        items: suggestions,
        itemKey: commandItemKey,
        getRow: getCommandRow,
      },
    ],
    [suggestions],
  );

  return (
    <SuggestionPanel sections={sections} highlightedIndex={highlightedIndex} onSelect={onSelect} />
  );
});
