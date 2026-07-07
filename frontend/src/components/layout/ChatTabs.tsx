import { useCallback, useEffect, useMemo } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner';
import { ChatStatusDot, type ChatStatusTone } from '@/components/ui/ChatStatusDot';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/utils/cn';
import { stripMarkdownTitle } from '@/utils/format';
import { isSecondaryTile } from '@/utils/tileHelpers';

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
      className={cn(
        // Full height so the label centers on the title bar's optical line (with
        // the traffic lights / sidebar controls); only the underline hugs the edge.
        'group relative flex h-full min-w-0 max-w-[180px] flex-shrink-0 items-center gap-1 rounded-md pl-2 pr-1',
        'transition-colors duration-200',
        isActive
          ? // The underline indicator below marks the active tab — no fill, so
            // the strip stays a single flat band.
            'text-text-primary dark:text-text-dark-primary'
          : 'text-text-tertiary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
      )}
    >
      <FloatingTooltip
        content={status ? `${title} · ${STATUS_LABELS[status]}` : title}
        className="flex min-w-0 flex-1"
      >
        <Button
          variant="unstyled"
          onClick={() => onSelect(chatId)}
          aria-current={isCurrent ? 'page' : undefined}
          className="flex w-full min-w-0 items-center gap-1.5 text-left text-2xs font-medium"
        >
          {/* The status glyph claims the icon slot while a status is live; at rest
              the chat's provider glyph (Claude, Codex…) matches the sidebar. */}
          {status === 'streaming' ? (
            <AsciiSpinner className="w-3 flex-shrink-0 text-center text-sm leading-none" />
          ) : statusDotTone ? (
            // h-3 w-3 box centers the 8px dot in the provider icon's footprint
            <ChatStatusDot
              tone={statusDotTone}
              className="h-3 w-3 flex-shrink-0 items-center justify-center"
            />
          ) : (
            agentKind && <ProviderIcon agentKind={agentKind} className="h-3 w-3 flex-shrink-0" />
          )}
          <span className="min-w-0 truncate">{title}</span>
        </Button>
      </FloatingTooltip>
      <Button
        variant="unstyled"
        onClick={() => onClose(chatId)}
        className={cn(
          'flex h-5 w-4 items-center justify-center rounded-md',
          'text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary',
          'transition-opacity duration-200',
          // focus-visible keeps the hidden close button perceivable for keyboard
          // users — it stays in the tab order even while opacity-0.
          isActive ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
        )}
        aria-label={`Close ${title} tab`}
      >
        <X className="h-3 w-3" />
      </Button>
      {isActive && (
        // The strip overlaps the band's hairline by 1px (-mb-px on the
        // container), so this 2px line covers it and reads as crossing it.
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text-primary dark:bg-text-dark-primary"
        />
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
    // -mb-px drops the strip over the title bar's hairline so the active tab's
    // underline can cross its segment of the border.
    <div className="-mb-px flex h-full min-w-0 gap-1 overflow-x-auto">
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
        className={cn(
          'flex h-5 w-5 flex-shrink-0 items-center justify-center self-center rounded-md',
          'text-text-tertiary hover:bg-surface-hover hover:text-text-primary',
          'dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
          'transition-colors duration-200',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
