import { useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { useUIStore } from '@/store/uiStore';
import { useBlockedChatIds } from '@/hooks/useBlockedChatIds';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { stripMarkdownTitle } from '@/utils/format';
import { paintedChatIds } from '@/utils/tileHelpers';
import { TitleBarTab, TitleBarTabs } from '@/components/layout/TitleBarTab/TitleBarTab';
import styles from './ChatTabs.module.scss';

type ChatTabStatus = 'blocked' | 'streaming';

const STATUS_LABELS: Record<ChatTabStatus, string> = {
  blocked: 'Needs you',
  streaming: 'Running',
};

interface ChatTabMenu {
  chatId: string;
  trigger: ReactNode;
}

export function ChatStatusIcon({ status }: { status: ChatTabStatus }) {
  return status === 'streaming' ? (
    <AsciiSpinner className={styles['tab-spinner']} />
  ) : (
    <ChatStatusDot tone={status} className={styles['tab-status-dot']} />
  );
}

interface ChatTabProps {
  chatId: string;
  isActive: boolean;
  isCurrent: boolean;
  status: ChatTabStatus;
  menu: ReactNode;
  onSelect: (chatId: string) => void;
  onClose: (chatId: string) => void;
}

function ChatTab({ chatId, isActive, isCurrent, status, menu, onSelect, onClose }: ChatTabProps) {
  const chatQuery = useChatQuery(chatId);
  // Close only on confirmed 404 — transient network/auth errors must not wipe tabs.
  const isChatGone = (chatQuery.error as (Error & { status?: number }) | null)?.status === 404;
  useEffect(() => {
    if (isChatGone) useUIStore.getState().closeChatTab(chatId);
  }, [isChatGone, chatId]);

  const title = chatQuery.data?.title ? stripMarkdownTitle(chatQuery.data.title) : '…';

  return (
    <TitleBarTab
      icon={<ChatStatusIcon status={status} />}
      title={title}
      isActive={isActive}
      menu={menu}
      actions={{
        tooltip: `${title} · ${STATUS_LABELS[status]}`,
        isCurrent,
        onSelect: () => onSelect(chatId),
        onClose: () => onClose(chatId),
      }}
    />
  );
}

// Working-set tabs (sidebar is the archive); re-clicking the current chat surfaces the agent pane.
export function ChatTabs({ tabs, menu }: { tabs: string[]; menu?: ChatTabMenu }) {
  const navigate = useNavigate();
  // TitleBar sits outside /chat/:chatId, so read the route from the location.
  const routedChatId = useMatch('/chat/:chatId')?.params.chatId;
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const visibleLayout = useUIStore((s) => s.visibleLayout);
  const blockedChatIdSet = useBlockedChatIds();

  // From layout (not splitChatIds): a split chat under a full-screen primary is off-screen.
  const visibleChatIds = useMemo(
    () => paintedChatIds(visibleLayout.flat(), splitChatIds, routedChatId),
    [visibleLayout, routedChatId, splitChatIds],
  );

  const handleSelect = useCallback(
    (chatId: string) => {
      if (chatId !== routedChatId) {
        navigate(`/chat/${chatId}`);
        return;
      }
      // Re-clicking the current chat surfaces the agent pane.
      const ui = useUIStore.getState();
      if (ui.visibleLayout.flat().includes('agent:primary')) ui.focusTile('agent:primary');
      else ui.activateTab('agent:primary');
    },
    [navigate, routedChatId],
  );

  const handleClose = useCallback(
    (chatId: string) => {
      const ui = useUIStore.getState();
      // Closed tab leaves the working set — tear down its split too.
      if (ui.splitChatIds.includes(chatId)) ui.closeSplitChat(chatId);
      const index = tabs.indexOf(chatId);
      ui.closeChatTab(chatId);
      if (chatId !== routedChatId) return;
      const remaining = tabs.filter((id) => id !== chatId);
      const next = remaining[Math.min(index, remaining.length - 1)];
      navigate(next ? `/chat/${next}` : '/');
    },
    [navigate, routedChatId, tabs],
  );

  return (
    <TitleBarTabs>
      {tabs.map((chatId) => {
        const status: ChatTabStatus = blockedChatIdSet.has(chatId) ? 'blocked' : 'streaming';
        return (
          <ChatTab
            key={chatId}
            chatId={chatId}
            isActive={visibleChatIds.has(chatId)}
            isCurrent={chatId === routedChatId}
            status={status}
            menu={menu?.chatId === chatId && menu.trigger}
            onSelect={handleSelect}
            onClose={handleClose}
          />
        );
      })}
    </TitleBarTabs>
  );
}
