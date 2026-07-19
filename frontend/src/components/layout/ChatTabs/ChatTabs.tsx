import { useCallback, useEffect, useMemo } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { ChatStatusDot, type ChatStatusTone } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import { useIsMobile } from '@/hooks/useIsMobile';
import clsx from 'clsx';
import { stripMarkdownTitle } from '@/utils/format';
import { splitSlotOfTile } from '@/utils/tileHelpers';
import { stateClasses } from '@/config/stateClasses';
import styles from './ChatTabs.module.scss';

type ChatTabStatus = 'blocked' | 'streaming' | 'completed';

const STATUS_LABELS: Record<ChatTabStatus, string> = {
  blocked: 'Needs you',
  streaming: 'Running',
  completed: 'Done',
};

interface ChatTabProps {
  chatId: string;
  isActive: boolean;
  isCurrent: boolean;
  status: ChatTabStatus | null;
  onSelect: (chatId: string) => void;
  onClose: (chatId: string) => void;
}

function ChatTab({ chatId, isActive, isCurrent, status, onSelect, onClose }: ChatTabProps) {
  const chatQuery = useChatQuery(chatId);
  // Close only on confirmed 404 — transient network/auth errors must not wipe tabs.
  const isChatGone = (chatQuery.error as (Error & { status?: number }) | null)?.status === 404;
  useEffect(() => {
    if (isChatGone) useUIStore.getState().closeChatTab(chatId);
  }, [isChatGone, chatId]);

  const title = chatQuery.data?.title ? stripMarkdownTitle(chatQuery.data.title) : '…';
  // Streaming uses AsciiSpinner; blocked/completed map straight to ChatStatusDot.
  const statusDotTone: ChatStatusTone | null = status && status !== 'streaming' ? status : null;
  const agentKind = useChatAgentKind(chatId, chatQuery.data?.session_agent_kind);

  return (
    <div
      // Middle-click closes (browser/editor tab convention).
      onAuxClick={(e) => {
        if (e.button === 1) onClose(chatId);
      }}
      // Full height centers the label on the title bar; underline-only active state.
      className={clsx(styles['chat-tab'], isActive && stateClasses.ACTIVE)}
    >
      <FloatingTooltip
        content={status ? `${title} · ${STATUS_LABELS[status]}` : title}
        className={styles['tab-tooltip']}
      >
        <Button
          variant="unstyled"
          onClick={() => onSelect(chatId)}
          aria-current={isCurrent ? 'page' : undefined}
          className={styles['tab-select']}
        >
          {status === 'streaming' ? (
            <AsciiSpinner className={styles['tab-spinner']} />
          ) : statusDotTone ? (
            <ChatStatusDot tone={statusDotTone} className={styles['tab-status-dot']} />
          ) : (
            agentKind && (
              <ProviderIcon agentKind={agentKind} className={styles['tab-provider-icon']} />
            )
          )}
          <span className={styles['tab-title']}>{title}</span>
        </Button>
      </FloatingTooltip>
      {/* Close stays focusable (opacity-0) so keyboard users can still reach it. */}
      <Button
        variant="unstyled"
        onClick={() => onClose(chatId)}
        className={styles['tab-close']}
        aria-label={`Close ${title} tab`}
      >
        <X className={styles['close-icon']} />
      </Button>
      {isActive && (
        // The strip overlaps the band's hairline by 1px (-mb-px on the
        // container), so this 2px line covers it and reads as crossing it.
        <span aria-hidden="true" className={styles['tab-underline']} />
      )}
    </div>
  );
}

// Working-set tabs (sidebar is the archive); re-clicking the current chat surfaces the agent pane.
export function ChatTabs() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // TitleBar sits outside /chat/:chatId, so read the route from the location.
  const routedChatId = useMatch('/chat/:chatId')?.params.chatId;
  const chatTabs = useUIStore((s) => s.chatTabs);
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const visibleLayout = useUIStore((s) => s.visibleLayout);
  const activeStreamMetadata = useStreamStore((s) => s.activeStreamMetadata);
  // Marked on stream success; sidebar clears when the chat is viewed.
  const completedChatIds = useStreamStore((s) => s.completedChatIds);
  const pendingRequests = usePermissionStore((s) => s.pendingRequests);

  // From layout (not splitChatIds): a split chat under a full-screen primary is off-screen.
  const visibleChatIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tileId of visibleLayout.flat()) {
      const slot = splitSlotOfTile(tileId);
      const owner = slot ? splitChatIds[slot - 1] : routedChatId;
      if (owner) ids.add(owner);
    }
    return ids;
  }, [visibleLayout, routedChatId, splitChatIds]);

  const streamingChatIdSet = useMemo(
    () => new Set(activeStreamMetadata.map((meta) => meta.chatId)),
    [activeStreamMetadata],
  );
  const blockedChatIdSet = useMemo(() => new Set(pendingRequests.keys()), [pendingRequests]);

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
      const tabs = ui.chatTabs;
      const index = tabs.indexOf(chatId);
      ui.closeChatTab(chatId);
      if (chatId !== routedChatId) return;
      const remaining = tabs.filter((id) => id !== chatId);
      const next = remaining[Math.min(index, remaining.length - 1)];
      navigate(next ? `/chat/${next}` : '/');
    },
    [navigate, routedChatId],
  );

  if (isMobile || chatTabs.length === 0) return null;

  return (
    <div className={styles['chat-tabs']}>
      {chatTabs.map((chatId) => {
        const status: ChatTabStatus | null = blockedChatIdSet.has(chatId)
          ? 'blocked'
          : streamingChatIdSet.has(chatId)
            ? 'streaming'
            : completedChatIds.has(chatId)
              ? 'completed'
              : null;
        return (
          <ChatTab
            key={chatId}
            chatId={chatId}
            isActive={visibleChatIds.has(chatId)}
            isCurrent={chatId === routedChatId}
            status={status}
            onSelect={handleSelect}
            onClose={handleClose}
          />
        );
      })}
    </div>
  );
}
