import type { MouseEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ViewSwitcher } from '@/components/layout/ViewSwitcher/ViewSwitcher';
import { DROPDOWN_MARGIN, DROPDOWN_WIDTH } from '@/config/constants';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUIStore } from '@/store/uiStore';
import { stripMarkdownTitle } from '@/utils/format';
import {
  agentTileFor,
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

interface AgentPaneHeaderProps {
  agentTile: AgentTileId;
  chatId: string;
  inTile: boolean;
}

function AgentPaneHeader({ agentTile, chatId, inTile }: AgentPaneHeaderProps) {
  const navigate = useNavigate();
  const chat = useChatQuery(chatId).data;
  const focused = useUIStore((s) => s.activeAgentTile === agentTile);
  const firstSplitChatId = useUIStore((s) => s.splitChatIds[0]);
  const menuOpen = useUIStore(
    (s) => s.chatMenu?.source === 'pane' && s.chatMenu.chat.id === chatId,
  );

  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    if (!chat) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(
      DROPDOWN_MARGIN,
      Math.min(rect.right - DROPDOWN_WIDTH, window.innerWidth - DROPDOWN_WIDTH - DROPDOWN_MARGIN),
    );
    useUIStore.getState().toggleChatMenu({
      chat,
      position: { top: rect.bottom + 4, left },
      source: 'pane',
    });
  };

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
      <div className={styles['title-wrap']}>
        <span className={clsx(styles.title, focused && styles['title--focused'])}>
          {chat ? stripMarkdownTitle(chat.title) : ''}
        </span>
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
}

function ViewTileHeader({ tileId, chatId, inTile }: ViewTileHeaderProps) {
  const title = useChatQuery(chatId).data?.title;
  const view = tileIdToViewType(tileId);
  const agentTile = agentTileFor(tileId);
  const agentVisible = useUIStore((s) => s.visibleLayout.some((row) => row.includes(agentTile)));
  const Icon = VIEW_ICONS[view];
  const label = VIEW_LABELS[view];

  return (
    <div className={clsx(styles.header, inTile && styles['header--in-tile'])}>
      <Icon className={styles['view-glyph']} />
      <span className={styles['view-label']}>
        {title ? `${label} · ${stripMarkdownTitle(title)}` : label}
      </span>
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
}

function PaneHeader({ tileId, chatId, inTile }: PaneHeaderProps) {
  if (tileIdToViewType(tileId) === 'agent') {
    return <AgentPaneHeader agentTile={agentTileFor(tileId)} chatId={chatId} inTile={inTile} />;
  }
  return <ViewTileHeader tileId={tileId} chatId={chatId} inTile={inTile} />;
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
}

export function PaneHeaderBand({ routedChatId, leading }: PaneHeaderBandProps) {
  const topRow = useUIStore((s) => s.visibleLayout[0]);
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const sessionPanelOpen = useUIStore((s) => s.sessionPanelOpen);

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
              {chatId && <PaneHeader tileId={tileId} chatId={chatId} inTile={false} />}
            </div>
          );
        })}
      </div>
      {sessionPanelOpen && <div className={styles['panel-column']} />}
    </div>
  );
}
