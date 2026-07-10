import { memo, useMemo } from 'react';
import clsx from 'clsx';
import { SuggestionPanel } from './SuggestionPanel';
import { MentionIcon } from './MentionIcon';
import type { MentionItem } from '@/types/ui.types';
import styles from './MentionSuggestionsPanel.module.scss';

interface MentionSuggestionsPanelProps {
  files: MentionItem[];
  highlightedIndex: number;
  onSelect: (item: MentionItem) => void;
}

function renderFile(file: MentionItem, isActive: boolean) {
  return (
    <>
      <MentionIcon name={file.name} className={styles['file-icon']} />
      <div className={styles['file-row']}>
        <span className={clsx(styles['file-name'], isActive && styles['file-name--active'])}>
          {file.name}
        </span>
        <span className={styles['file-path']}>{file.path}</span>
      </div>
    </>
  );
}

const fileItemKey = (item: MentionItem) => item.path;

export const MentionSuggestionsPanel = memo(function MentionSuggestionsPanel({
  files,
  highlightedIndex,
  onSelect,
}: MentionSuggestionsPanelProps) {
  const sections = useMemo(
    () => [
      {
        label: 'Files',
        items: files,
        itemKey: fileItemKey,
        renderItem: renderFile,
      },
    ],
    [files],
  );

  return (
    <SuggestionPanel sections={sections} highlightedIndex={highlightedIndex} onSelect={onSelect} />
  );
});
