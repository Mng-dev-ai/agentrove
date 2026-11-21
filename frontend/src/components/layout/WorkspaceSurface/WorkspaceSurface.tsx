import { Suspense, useLayoutEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { useLocation } from 'react-router-dom';
import { lazyNamed } from '@/utils/lazyNamed';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionPanelOpen } from '@/hooks/useSessionPanelOpen';
import { SplitViewContainer } from '@/components/ui/SplitViewContainer/SplitViewContainer';
import { CommandMenu } from '@/components/ui/command-menu/CommandMenu';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback/ViewLoadingFallback';
import { agentTileFor, paintedLayout, panelHostTile, tileIdToViewType } from '@/utils/tileHelpers';
import type { Chat } from '@/types/chat.types';
import type { TileId, ViewType } from '@/types/ui.types';
import styles from './WorkspaceSurface.module.scss';

const EditorPane = lazyNamed(
  () => import('@/components/editor/editor-core/EditorPane'),
  'EditorPane',
);
const DiffView = lazyNamed(() => import('@/components/sandbox/git/DiffView/DiffView'), 'DiffView');
const TerminalContainer = lazyNamed(
  () => import('@/components/sandbox/terminal/Container/Container'),
  'Container',
);
const CreateBranchDialog = lazyNamed(
  () => import('@/components/chat/github/CreateBranchDialog'),
  'CreateBranchDialog',
);
const CreateCommitDialog = lazyNamed(
  () => import('@/components/chat/github/CreateCommitDialog'),
  'CreateCommitDialog',
);
const CreatePRDialog = lazyNamed(
  () => import('@/components/chat/github/CreatePRDialog'),
  'CreatePRDialog',
);

function renderPane(
  view: ViewType,
  chatId: string | undefined,
  isVisible: boolean,
  agent: ReactNode,
): ReactNode {
  if (view === 'agent') return agent;
  if (!chatId) return null;
  switch (view) {
    case 'editor':
      return (
        <Suspense fallback={viewLoadingFallback}>
          <EditorPane chatId={chatId} />
        </Suspense>
      );
    case 'diff':
      return (
        <Suspense fallback={viewLoadingFallback}>
          <DiffView chatId={chatId} isVisible={isVisible} />
        </Suspense>
      );
    default:
      return null;
  }
}

interface WorkspaceTileProps {
  tileId: TileId;
  isVisible: boolean;
  // Chat whose sandbox backs the terminal, editor and diff views of this tile.
  chatId: string | undefined;
  chat: Chat | undefined;
  agent: ReactNode;
  header: ReactNode;
  sessionPanel?: ReactNode;
}

export function WorkspaceTile({
  tileId,
  isVisible,
  chatId,
  chat,
  agent,
  header,
  sessionPanel,
}: WorkspaceTileProps) {
  const view = tileIdToViewType(tileId);
  const isTerminal = view === 'terminal';
  const isMobile = useIsMobile();
  const agentTile = agentTileFor(tileId);
  const panelOpen = useSessionPanelOpen(agentTile);
  const isPanelHost = useUIStore(
    (s) =>
      panelHostTile(paintedLayout(s.visibleLayout, s.focusedTile, isMobile), agentTile) === tileId,
  );
  const panel = isVisible && panelOpen && isPanelHost && sessionPanel;
  return (
    <div className={styles.tile}>
      {header}
      <div
        className={styles.content}
        // focusTile keeps shortcuts, tab highlight and panel actions on the pane in use.
        onPointerDownCapture={() => useUIStore.getState().focusTile(tileId)}
      >
        <div className={clsx(styles.body, isMobile && panel && styles.hidden)}>
          <div className={isTerminal ? styles.fill : styles.hidden}>
            <Suspense fallback={viewLoadingFallback}>
              <TerminalContainer
                sandboxId={chat?.sandbox_id}
                storageScope={chatId}
                // Spawn shell in worktree so terminal matches agent/editor/diff cwd.
                worktreeCwd={chat?.worktree_cwd ?? undefined}
                // Background tiles are mounted but zero-size — only fit when visible.
                isVisible={isTerminal && isVisible}
                panelKey={`tile-${tileId}`}
              />
            </Suspense>
          </div>
          <div className={isTerminal ? styles.hidden : styles.fill}>
            {renderPane(view, chatId, isVisible, agent)}
          </div>
        </div>
        {panel}
      </div>
    </div>
  );
}

interface WorkspaceSurfaceProps {
  renderView: (tileId: TileId, isVisible: boolean) => ReactNode;
  // One panel beside the whole workspace; without it each pane's tile carries its own.
  sessionPanel?: ReactNode;
  children?: ReactNode;
}

export function WorkspaceSurface({ renderView, sessionPanel, children }: WorkspaceSurfaceProps) {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const sessionPanelOpen = useSessionPanelOpen('agent:primary');
  const createCommitDialogOpen = useUIStore((s) => s.createCommitDialogOpen);
  const createPRDialogOpen = useUIStore((s) => s.createPRDialogOpen);
  const createBranchDialogOpen = useUIStore((s) => s.createBranchDialogOpen);
  // The phone panel is a transient view of this route; layout effect so a new route never paints it.
  useLayoutEffect(() => {
    useUIStore.getState().closeMobileSessionPanel();
  }, [pathname, isMobile]);
  const panel = sessionPanelOpen && sessionPanel;

  return (
    <div className={styles.root}>
      <div className={isMobile && panel ? styles.hidden : styles.surface}>
        <SplitViewContainer renderView={renderView} paneSessionPanels={!sessionPanel} />
      </div>
      {panel}
      <CommandMenu />
      {children}
      {createCommitDialogOpen && (
        <Suspense fallback={null}>
          <CreateCommitDialog
            onClose={() => useUIStore.getState().setCreateCommitDialogOpen(false)}
          />
        </Suspense>
      )}
      {createPRDialogOpen && (
        <Suspense fallback={null}>
          <CreatePRDialog onClose={() => useUIStore.getState().setCreatePRDialogOpen(false)} />
        </Suspense>
      )}
      {createBranchDialogOpen && (
        <Suspense fallback={null}>
          <CreateBranchDialog
            onClose={() => useUIStore.getState().setCreateBranchDialogOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
