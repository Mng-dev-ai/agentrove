import type { MouseEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ViewSwitcher } from '@/components/layout/ViewSwitcher/ViewSwitcher';
import { ChatStatusIcon, ChatTabs } from '@/components/layout/ChatTabs/ChatTabs';
import { DROPDOWN_MARGIN } from '@/config/constants';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useBlockedChatIds } from '@/hooks/useBlockedChatIds';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useStreamStore } from '@/store/streamStore';
import { useUIStore } from '@/store/uiStore';
import { stripMarkdownTitle } from '@/utils/format';
import {
  agentTileFor,
  paintedChatIds,
  tileChatId,
  tileIdToViewType,
  VIEW_ICONS,
  VIEW_LABELS,
} from '@/utils/tileHelpers';
import type { AgentTileId, TileId } from '@/types/ui.types';
import styles from './PaneHeader.module.scss';

interface CloseButtonProps {
  label: string;
  onClick: () => void;
}

function CloseButton({ label, onClick }: CloseButtonProps) {
  return (
    <FloatingTooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={styles['icon-button']}
        onClick={onClick}
        aria-label={label}
      >
        <X className={styles['icon-button-glyph']} />
      </Button>
    </FloatingTooltip>
  );
}

function ChatMenuTrigger({ chatId }: { chatId: string }) {
  const chat = useChatQuery(chatId).data;
  const menuOpen = useUIStore(
    (s) => s.chatMenu?.source === 'pane' && s.chatMenu.chat.id === chatId,
  );

  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    if (!chat) return;
    const rect = event.currentTarget.getBoundingClientRect();
    useUIStore.getState().toggleChatMenu({
      chat,
      position: {
        top: rect.bottom + 4,
        right: Math.max(DROPDOWN_MARGIN, window.innerWidth - rect.right),
      },
      source: 'pane',
    });
  };

  return (
    <Button
      type="button"
      variant="unstyled"
      className={styles.chevron}
      onClick={toggleMenu}
      data-chat-menu-trigger
      aria-label="Chat menu"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
    >
      <ChevronDown className={styles['chevron-icon']} />
    </Button>
  );
}

interface AgentPaneHeaderProps {
  agentTile: AgentTileId;
  chatId: string;
  inTile: boolean;
  tabs?: string[];
  inStrip: boolean;
}

function AgentPaneHeader({ agentTile, chatId, inTile, tabs, inStrip }: AgentPaneHeaderProps) {
  const navigate = useNavigate();
  const chat = useChatQuery(chatId).data;
  const focused = useUIStore((s) => s.activeAgentTile === agentTile);
  const firstSplitChatId = useUIStore((s) => s.splitChatIds[0]);
  const blocked = useBlockedChatIds().has(chatId);
  const streaming = useStreamStore((s) =>
    s.activeStreamMetadata.some((meta) => meta.chatId === chatId),
  );
  const status = blocked ? 'blocked' : streaming ? 'streaming' : null;
  const menuTrigger = <ChatMenuTrigger chatId={chatId} />;

  const closePane = () => {
    if (agentTile === 'agent:primary') {
      useUIStore.getState().promoteFirstSplit();
      navigate(`/chat/${firstSplitChatId}`);
    } else {
      useUIStore.getState().closeSplitChat(chatId);
    }
  };

  return (
    <div className={clsx(styles.header, inTile && styles['header--in-tile'])}>
      <div className={styles.naming}>
        {!inStrip && (
          <div className={styles['title-wrap']}>
            {status && <ChatStatusIcon status={status} />}
            <span className={clsx(styles.title, focused && styles['title--focused'])}>
              {chat ? stripMarkdownTitle(chat.title) : ''}
            </span>
            {menuTrigger}
          </div>
        )}
        {tabs && (
          <div className={clsx(styles.strip, !inStrip && styles['strip--after-title'])}>
            <ChatTabs tabs={tabs} menu={{ chatId, trigger: menuTrigger }} />
          </div>
        )}
      </div>
      <div className={styles.actions}>
        <ViewSwitcher agentTile={agentTile} />
        {firstSplitChatId && <CloseButton label="Close pane" onClick={closePane} />}
      </div>
    </div>
  );
}

interface ViewTileHeaderProps {
  tileId: TileId;
  chatId: string;
  inTile: boolean;
  tabs?: string[];
  inStrip: boolean;
}

function ViewTileHeader({ tileId, chatId, inTile, tabs, inStrip }: ViewTileHeaderProps) {
  const title = useChatQuery(chatId).data?.title;
  const view = tileIdToViewType(tileId);
  const agentTile = agentTileFor(tileId);
  const agentVisible = useUIStore((s) => s.visibleLayout.some((row) => row.includes(agentTile)));
  const Icon = VIEW_ICONS[view];
  const label = VIEW_LABELS[view];

  return (
    <div className={clsx(styles.header, inTile && styles['header--in-tile'])}>
      <div className={styles.naming}>
        <Icon className={styles['view-glyph']} />
        <span className={styles['view-label']}>
          {title && !inStrip ? `${label} · ${stripMarkdownTitle(title)}` : label}
        </span>
        {tabs && (
          <div className={clsx(styles.strip, styles['strip--after-title'])}>
            <ChatTabs tabs={tabs} />
          </div>
        )}
      </div>
      <div className={styles.actions}>
        {!agentVisible && <ViewSwitcher agentTile={agentTile} />}
        <CloseButton
          label={`Close ${label}`}
          onClick={() => useUIStore.getState().removeTab(tileId)}
        />
      </div>
    </div>
  );
}

interface PaneHeaderProps {
  tileId: TileId;
  chatId: string;
  inTile: boolean;
  tabs?: string[];
  inStrip?: boolean;
}

function PaneHeader({ tileId, chatId, inTile, tabs, inStrip = false }: PaneHeaderProps) {
  if (tileIdToViewType(tileId) === 'agent') {
    return (
      <AgentPaneHeader
        agentTile={agentTileFor(tileId)}
        chatId={chatId}
        inTile={inTile}
        tabs={tabs}
        inStrip={inStrip}
      />
    );
  }
  return (
    <ViewTileHeader tileId={tileId} chatId={chatId} inTile={inTile} tabs={tabs} inStrip={inStrip} />
  );
}

export function InTilePaneHeader({ tileId, chatId }: { tileId: TileId; chatId: string }) {
  const isMobile = useIsMobile();
  const inTopRow = useUIStore((s) => s.visibleLayout[0].includes(tileId));
  if (isMobile || inTopRow) return null;
  return <PaneHeader tileId={tileId} chatId={chatId} inTile />;
}

interface PaneHeaderBandProps {
  routedChatId: string;
  leading: ReactNode;
  tabs: string[];
}

// Column 0's header hosts the tab strip; a chat another agent pane names is left out of it.
export function PaneHeaderBand({ routedChatId, leading, tabs }: PaneHeaderBandProps) {
  const visibleLayout = useUIStore((s) => s.visibleLayout);
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const sessionPanelOpen = useUIStore((s) => s.sessionPanelOpen);
  const topRow = visibleLayout[0];

  const namedByOtherPanes = paintedChatIds(
    visibleLayout.flat().filter((tile) => tile !== topRow[0] && tileIdToViewType(tile) === 'agent'),
    splitChatIds,
    routedChatId,
  );
  const stripTabs = tabs.filter((chatId) => !namedByOtherPanes.has(chatId));

  return (
    <div className={styles.band}>
      <div
        className={styles.columns}
        style={{ gridTemplateColumns: `repeat(${topRow.length}, minmax(0, 1fr))` }}
      >
        {topRow.map((tileId, index) => {
          const chatId = tileChatId(tileId, splitChatIds, routedChatId);
          return (
            <div
              key={tileId}
              className={clsx(styles.column, index > 0 && styles['column--divided'])}
            >
              {index === 0 && leading && <div className={styles.leading}>{leading}</div>}
              {chatId && (
                <PaneHeader
                  tileId={tileId}
                  chatId={chatId}
                  inTile={false}
                  tabs={index === 0 && stripTabs.length > 0 ? stripTabs : undefined}
                  inStrip={stripTabs.includes(chatId)}
                />
              )}
            </div>
          );
        })}
      </div>
      {sessionPanelOpen && <div className={styles['panel-column']} />}
    </div>
  );
}
