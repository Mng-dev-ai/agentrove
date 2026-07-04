import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/utils/cn';
import { stripMarkdownTitle } from '@/utils/format';
import { isSecondaryTile, VIEW_ICONS } from '@/utils/tileHelpers';

type ChatTabStatus = 'blocked' | 'streaming' | 'finished';

const STATUS_LABELS: Record<ChatTabStatus, string> = {
  blocked: 'Awaiting approval',
  streaming: 'Running',
  finished: 'Finished',
};

const STATUS_DOT_CLASS: Record<ChatTabStatus, string> = {
  // Pulsing amber = running (same signal as the sidebar); steady amber = the
  // agent is paused on an approval; green = a turn finished off-screen.
  streaming: 'animate-pulse bg-warning-500',
  blocked: 'bg-warning-500',
  finished: 'bg-success-500',
};

const AgentIcon = VIEW_ICONS.agent;

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

  return (
    <div
      // Middle-click closes, matching browser/editor tab conventions.
      onAuxClick={(e) => {
        if (e.button === 1) onClose(chatId);
      }}
      className={cn(
        'group flex h-8 min-w-0 max-w-[180px] flex-shrink-0 items-center gap-1 pl-2 pr-1',
        'transition-colors duration-200',
        isActive
          ? // Browser-style: the active tab wears the page surface and sits over the
            // band's hairline, merging into the content below.
            'rounded-t-lg border border-b-0 border-border/50 bg-surface text-text-primary dark:border-border-dark/50 dark:bg-surface-dark dark:text-text-dark-primary'
          : // mb-px lifts inactive tabs back above the hairline the strip overlaps.
            'mb-px rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
      )}
    >
      <Button
        variant="unstyled"
        onClick={() => onSelect(chatId)}
        aria-current={isCurrent ? 'page' : undefined}
        title={status ? `${title} · ${STATUS_LABELS[status]}` : title}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-2xs font-medium"
      >
        {/* The status dot claims the icon slot while the turn is live — the
            agent glyph carries no information a colored dot doesn't. */}
        {status ? (
          <span
            className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', STATUS_DOT_CLASS[status])}
          />
        ) : (
          <AgentIcon className="h-3 w-3 flex-shrink-0" />
        )}
        <span className="min-w-0 truncate">{title}</span>
      </Button>
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
    </div>
  );
}

// Title-bar chat tabs — the working set of open chats (the sidebar stays the
// full archive). Each tab is also the chat's agent-view tab: clicking the
// current chat's tab surfaces the agent pane. A live status dot fed by the
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
  const pendingRequests = usePermissionStore((s) => s.pendingRequests);

  // Chats with a pane on screen: secondary tiles belong to the split chat, all
  // others to the routed chat. Derived from the layout, not secondaryChatId —
  // a split chat hidden behind a full-screen primary view is off screen, so its
  // tab must drop the active highlight and still earn a finished dot.
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

  // Chats whose stream ended while they weren't on screen — drives the
  // "finished" dot until the user views the chat again.
  const [finishedChatIds, setFinishedChatIds] = useState<Set<string>>(new Set());
  const prevStreamingRef = useRef<Set<string>>(new Set());

  // Detecting the streaming→settled transition needs the previous streaming
  // set, so it can't be derived inline. Covers every end-of-stream path
  // (complete/cancelled/error envelopes and the orphan-metadata prune), since
  // all of them remove the chat's entry from activeStreamMetadata. Chats that
  // settle while on screen are skipped — the user watched them finish.
  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = streamingChatIdSet;
    const ended = [...prev].filter((id) => !streamingChatIdSet.has(id) && !visibleChatIds.has(id));
    if (ended.length > 0) {
      setFinishedChatIds((prevSet) => new Set([...prevSet, ...ended]));
    }
  }, [streamingChatIdSet, visibleChatIds]);

  // Viewing a chat clears its finished dot — render-phase reset keyed on the
  // on-screen chat ids, per the state-reset-on-prop-change pattern.
  const seenFinished = [...visibleChatIds].filter((id) => finishedChatIds.has(id));
  if (seenFinished.length > 0) {
    setFinishedChatIds((prev) => {
      const next = new Set(prev);
      seenFinished.forEach((id) => next.delete(id));
      return next;
    });
  }

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
    // surface can cover its segment of the border.
    <div className="-mb-px flex h-full min-w-0 items-end gap-1 overflow-x-auto">
      {chatTabs.map((chatId, index) => {
        const status: ChatTabStatus | null = blockedChatIdSet.has(chatId)
          ? 'blocked'
          : streamingChatIdSet.has(chatId)
            ? 'streaming'
            : finishedChatIds.has(chatId)
              ? 'finished'
              : null;
        // Browser-tab convention: separators only between two inactive neighbors —
        // the active tab's raised card draws its own boundary.
        const showSeparator =
          index > 0 && !visibleChatIds.has(chatId) && !visibleChatIds.has(chatTabs[index - 1]);
        return (
          <Fragment key={chatId}>
            {showSeparator && (
              <span
                aria-hidden="true"
                className="mb-2.5 h-3.5 w-px flex-shrink-0 bg-border dark:bg-border-dark"
              />
            )}
            <ChatTab
              chatId={chatId}
              isActive={visibleChatIds.has(chatId)}
              isCurrent={chatId === routedChatId}
              status={status}
              onSelect={handleSelect}
              onClose={handleClose}
            />
          </Fragment>
        );
      })}
      {/* Browser-style new-tab button — the landing page is the "new tab page",
          so + just routes there instead of creating a chat eagerly. */}
      <Button
        variant="unstyled"
        onClick={() => navigate('/')}
        aria-label="New chat"
        className={cn(
          'mb-1.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md',
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
