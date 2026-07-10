import { useCallback, useEffect, useMemo } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
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
import { isSecondaryTile } from '@/utils/tileHelpers';
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
  // Shares the chat-query cache with the sidebar and panes; only the title is read.
  const chatQuery = useChatQuery(chatId);
  // Only a confirmed 404 (chat gone on the backend) closes the tab — transient
  // network/auth failures must not wipe the persisted working set.
  const isChatGone = (chatQuery.error as (Error & { status?: number }) | null)?.status === 404;
  useEffect(() => {
    if (isChatGone) useUIStore.getState().closeChatTab(chatId);
  }, [isChatGone, chatId]);

  const title = chatQuery.data?.title ? stripMarkdownTitle(chatQuery.data.title) : '…';
  // Streaming renders the braille spinner separately; blocked/completed are
  // already ChatStatusTone values, so they map straight to a dot.
  const statusDotTone: ChatStatusTone | null = status && status !== 'streaming' ? status : null;
  const agentKind = useChatAgentKind(chatId, chatQuery.data?.session_agent_kind);

  return (
    <div
      // Middle-click closes, matching browser/editor tab conventions.
      onAuxClick={(e) => {
        if (e.button === 1) onClose(chatId);
      }}
      // Full height so the label centers on the title bar's optical line (with
      // the traffic lights / sidebar controls); only the underline hugs the edge.
      // The underline indicator marks the active tab — no fill, so the strip
      // stays a single flat band.
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
          {/* The status glyph claims the icon slot while a status is live; at rest
              the chat's provider glyph (Claude, Codex…) matches the sidebar. */}
          {status === 'streaming' ? (
            <AsciiSpinner className={styles['tab-spinner']} />
          ) : statusDotTone ? (
            // h-3 w-3 box centers the 8px dot in the provider icon's footprint
            <ChatStatusDot tone={statusDotTone} className={styles['tab-status-dot']} />
          ) : (
            agentKind && (
              <ProviderIcon agentKind={agentKind} className={styles['tab-provider-icon']} />
            )
          )}
          <span className={styles['tab-title']}>{title}</span>
        </Button>
      </FloatingTooltip>
      {/* focus-visible keeps the hidden close button perceivable for keyboard
          users — it stays in the tab order even while opacity-0. */}
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

// Title-bar chat tabs — the working set of open chats (the sidebar stays the
// full archive). Each tab is also the chat's agent-view tab: clicking the
// current chat's tab surfaces the agent pane. A live status icon fed by the
// global stream and permission stores keeps background chats glanceable.
export function ChatTabs() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // TitleBar renders outside the /chat/:chatId route element, so match the
  // location directly instead of relying on route params.
  const routedChatId = useMatch('/chat/:chatId')?.params.chatId;
  const chatTabs = useUIStore((s) => s.chatTabs);
  const secondaryChatId = useUIStore((s) => s.secondaryChatId);
  const visibleLayout = useUIStore((s) => s.visibleLayout);
  const activeStreamMetadata = useStreamStore((s) => s.activeStreamMetadata);
  // Shared with the sidebar: marked by the stream service on successful
  // completion, cleared by the sidebar when the chat is viewed.
  const completedChatIds = useStreamStore((s) => s.completedChatIds);
  const pendingRequests = usePermissionStore((s) => s.pendingRequests);

  // Chats with a pane on screen: secondary tiles belong to the split chat, all
  // others to the routed chat. Derived from the layout, not secondaryChatId —
  // a split chat hidden behind a full-screen primary view is off screen, so its
  // tab must drop the active highlight.
  const visibleChatIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tileId of visibleLayout.flat()) {
      const owner = isSecondaryTile(tileId) ? secondaryChatId : routedChatId;
      if (owner) ids.add(owner);
    }
    return ids;
  }, [visibleLayout, routedChatId, secondaryChatId]);

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
      // The chat tab doubles as the agent tab — re-clicking it surfaces the
      // agent pane: focus it if already on screen, otherwise bring it up full.
      const ui = useUIStore.getState();
      if (ui.visibleLayout.flat().includes('agent:primary')) ui.focusTile('agent:primary');
      else ui.activateTab('agent:primary');
    },
    [navigate, routedChatId],
  );

  const handleClose = useCallback(
    (chatId: string) => {
      const ui = useUIStore.getState();
      // Closing the split chat's tab also tears the split down — a closed tab
      // means "out of the working set", not just "hide the tab".
      if (ui.secondaryChatId === chatId) ui.closeSplitChat();
      const tabs = ui.chatTabs;
      const index = tabs.indexOf(chatId);
      ui.closeChatTab(chatId);
      if (chatId !== routedChatId) return;
      // Land on the neighbor tab (next, else previous), or back on the landing page.
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
      {/* Browser-style new-tab button — the landing page is the "new tab page",
          so + just routes there instead of creating a chat eagerly. */}
      <Button
        variant="unstyled"
        onClick={() => navigate('/')}
        aria-label="New chat"
        className={styles['new-tab']}
      >
        <Plus className={styles['new-tab-icon']} />
      </Button>
    </div>
  );
}
