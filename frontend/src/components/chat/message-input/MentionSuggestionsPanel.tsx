import { memo, useMemo } from 'react';
import clsx from 'clsx';
import { MessageSquare } from 'lucide-react';
import { SuggestionPanel } from './SuggestionPanel';
import { MentionIcon } from './MentionIcon';
import type { MentionItem } from '@/types/ui.types';
import styles from './MentionSuggestionsPanel.module.scss';

interface MentionSuggestionsPanelProps {
  files: MentionItem[];
  chats: MentionItem[];
  highlightedIndex: number;
  onSelect: (item: MentionItem) => void;
}

function renderFile(file: MentionItem, isActive: boolean) {
  return (
    <>
      <MentionIcon name={file.name} className={styles['item-icon']} />
      <div className={styles['item-row']}>
        <span className={clsx(styles['item-name'], isActive && styles['item-name--active'])}>
          {file.name}
        </span>
        <span className={styles['item-path']}>{file.path}</span>
      </div>
    </>
  );
}

function renderChat(chat: MentionItem, isActive: boolean) {
  return (
    <>
      <MessageSquare className={styles['item-icon']} />
      <div className={styles['item-row']}>
        <span className={clsx(styles['item-name'], isActive && styles['item-name--active'])}>
          {chat.name}
        </span>
      </div>
    </>
  );
}

const mentionItemKey = (item: MentionItem) => item.path;

export const MentionSuggestionsPanel = memo(function MentionSuggestionsPanel({
  files,
  chats,
  highlightedIndex,
  onSelect,
}: MentionSuggestionsPanelProps) {
  const sections = useMemo(
    () => [
      {
        label: 'Files',
        items: files,
        itemKey: mentionItemKey,
        renderItem: renderFile,
      },
      {
        label: 'Chats',
        items: chats,
        itemKey: mentionItemKey,
        renderItem: renderChat,
      },
    ],
    [files, chats],
  );

  return (
    <SuggestionPanel sections={sections} highlightedIndex={highlightedIndex} onSelect={onSelect} />
  );
});
