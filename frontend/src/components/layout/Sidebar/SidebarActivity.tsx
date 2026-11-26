import clsx from 'clsx';
import { X } from 'lucide-react';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import type { Chat } from '@/types/chat.types';
import { stripMarkdownTitle } from '@/utils/format';
import { SidebarChatRow, type ChatRowProps } from './SidebarChatRow';
import type { SidebarActivityKind } from './useSidebarActivity';
import listStyles from './SidebarChatList.module.scss';
import styles from './SidebarActivity.module.scss';

const ACTIVITY_LABEL: Record<SidebarActivityKind, string> = {
  running: 'Running',
  'needs-you': 'Needs you',
};

const EMPTY_LABEL: Record<SidebarActivityKind, string> = {
  running: 'Nothing is running.',
  'needs-you': 'Nothing is waiting on you.',
};

interface SidebarActivityBarProps {
  counts: Record<SidebarActivityKind, number>;
  view: SidebarActivityKind | null;
  onChangeView: (view: SidebarActivityKind | null) => void;
}

export function SidebarActivityBar({ counts, view, onChangeView }: SidebarActivityBarProps) {
  const chip = (kind: SidebarActivityKind) => (
    <Button
      type="button"
      variant="unstyled"
      aria-pressed={view === kind}
      onClick={() => onChangeView(view === kind ? null : kind)}
      className={clsx(styles.chip, view === kind && styles['chip--on'])}
    >
      {counts[kind] > 0 &&
        (kind === 'running' ? (
          <AsciiSpinner className={styles['chip-spinner']} />
        ) : (
          <ChatStatusDot tone="blocked" />
        ))}
      {ACTIVITY_LABEL[kind]}
      <span className={styles['chip-count']}>{counts[kind]}</span>
    </Button>
  );
  return (
    <div className={styles.bar}>
      {chip('running')}
      {chip('needs-you')}
    </div>
  );
}

function ActivityRow({ chat, rowProps }: { chat: Chat; rowProps: ChatRowProps }) {
  const { data: parent } = useChatQuery(chat.parent_chat_id ?? undefined);
  return (
    <SidebarChatRow
      chat={chat}
      rowProps={rowProps}
      isFlat
      parentTitle={parent && stripMarkdownTitle(parent.title)}
    />
  );
}

interface SidebarActivityListProps {
  view: SidebarActivityKind;
  chats: Chat[];
  rowProps: ChatRowProps;
  onClose: () => void;
}

// Execution view: every active thread in one flat list, so nothing hides behind a
// collapsed parent or below the fold.
export function SidebarActivityList({ view, chats, rowProps, onClose }: SidebarActivityListProps) {
  return (
    <>
      <div className={styles.header}>
        <span>
          {ACTIVITY_LABEL[view]} · {chats.length}
        </span>
        <Button
          type="button"
          variant="unstyled"
          onClick={onClose}
          className={styles.close}
          aria-label="Back to all threads"
        >
          <X className={styles['close-icon']} />
        </Button>
      </div>
      {chats.length === 0 ? (
        <p className={listStyles.empty}>{EMPTY_LABEL[view]}</p>
      ) : (
        chats.map((chat) => <ActivityRow key={chat.id} chat={chat} rowProps={rowProps} />)
      )}
    </>
  );
}
