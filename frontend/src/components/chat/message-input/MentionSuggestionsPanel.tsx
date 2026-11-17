import { memo, useMemo } from 'react';
import { AtSign, MessageSquare } from 'lucide-react';
import { SuggestionPanel } from './SuggestionPanel';
import { MentionIcon } from './MentionIcon';
import type { MentionItem } from '@/types/ui.types';
import styles from './MentionSuggestionsPanel.module.scss';

const NO_MEMBERS: MentionItem[] = [];

interface MentionSuggestionsPanelProps {
  members?: MentionItem[];
  files: MentionItem[];
  chats: MentionItem[];
  highlightedIndex: number;
  onSelect: (item: MentionItem) => void;
}

function getFileRow(file: MentionItem) {
  const slash = file.path.lastIndexOf('/');
  return {
    icon: <MentionIcon name={file.name} className={styles['item-icon']} />,
    label: file.name,
    detail: slash > 0 ? file.path.slice(0, slash) : undefined,
    detailFromStart: true,
  };
}

const getMemberRow = (member: MentionItem) => ({
  icon: <AtSign className={styles['item-icon']} />,
  label: member.name,
});

const getChatRow = (chat: MentionItem) => ({
  icon: <MessageSquare className={styles['item-icon']} />,
  label: chat.name,
});

const mentionItemKey = (item: MentionItem) => item.path;

export const MentionSuggestionsPanel = memo(function MentionSuggestionsPanel({
  members = NO_MEMBERS,
  files,
  chats,
  highlightedIndex,
  onSelect,
}: MentionSuggestionsPanelProps) {
  const sections = useMemo(
    () => [
      {
        label: 'Members',
        items: members,
        itemKey: mentionItemKey,
        getRow: getMemberRow,
      },
      {
        label: 'Files',
        items: files,
        itemKey: mentionItemKey,
        getRow: getFileRow,
      },
      {
        label: 'Chats',
        items: chats,
        itemKey: mentionItemKey,
        getRow: getChatRow,
      },
    ],
    [members, files, chats],
  );

  return (
    <SuggestionPanel sections={sections} highlightedIndex={highlightedIndex} onSelect={onSelect} />
  );
});
