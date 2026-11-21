import { Suspense, useLayoutEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { lazyNamed } from '@/utils/lazyNamed';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionPanelOpen } from '@/hooks/useSessionPanelOpen';
import { SplitViewContainer } from '@/components/ui/SplitViewContainer/SplitViewContainer';
import { CommandMenu } from '@/components/ui/command-menu/CommandMenu';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback/ViewLoadingFallback';
import { tileIdToViewType } from '@/utils/tileHelpers';
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
}

export function WorkspaceTile({
  tileId,
  isVisible,
  chatId,
  chat,
  agent,
  header,
}: WorkspaceTileProps) {
  const view = tileIdToViewType(tileId);
  const isTerminal = view === 'terminal';
  return (
    <div className={styles.tile}>
      {header}
      <div
        className={styles.body}
        // focusTile keeps shortcuts + tab highlight on the pane in use.
        onPointerDownCapture={() => useUIStore.getState().focusTile(tileId)}
      >
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
    </div>
  );
}

interface WorkspaceSurfaceProps {
  renderView: (tileId: TileId, isVisible: boolean) => ReactNode;
  sessionPanel: ReactNode;
  children?: ReactNode;
}

export function WorkspaceSurface({ renderView, sessionPanel, children }: WorkspaceSurfaceProps) {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const sessionPanelOpen = useSessionPanelOpen();
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
        <SplitViewContainer renderView={renderView} />
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
