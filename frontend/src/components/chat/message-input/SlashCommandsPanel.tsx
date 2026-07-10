import { memo, useMemo } from 'react';
import clsx from 'clsx';
import { SuggestionPanel } from './SuggestionPanel';
import type { SlashCommand } from '@/types/ui.types';
import styles from './SlashCommandsPanel.module.scss';

interface SlashCommandsPanelProps {
  suggestions: SlashCommand[];
  highlightedIndex: number;
  onSelect: (command: SlashCommand) => void;
}

function renderCommand(command: SlashCommand, isActive: boolean) {
  return (
    <>
      <span className={clsx(styles['command-value'], isActive && styles['command-value--active'])}>
        {command.value}
      </span>
      {command.description && <span className={styles['command-desc']}>{command.description}</span>}
    </>
  );
}

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
        itemClassName: styles['command-item'],
        renderItem: renderCommand,
      },
    ],
    [suggestions],
  );

  return (
    <SuggestionPanel sections={sections} highlightedIndex={highlightedIndex} onSelect={onSelect} />
  );
});
