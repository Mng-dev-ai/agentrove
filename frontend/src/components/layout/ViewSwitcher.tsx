import { useMemo } from 'react';
import { Code, GitCompareArrows, KeyRound, SquareTerminal } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';
import { isSecondaryPaneActive, VIEW_LABELS, viewTypeToTileId } from '@/utils/tileHelpers';
import type { ViewType } from '@/types/ui.types';

// Non-agent secondary views, in the order Cursor lays them out: diff (git),
// editor (file), terminal, secrets. Icons mirror the command registry.
const SWITCHABLE_VIEWS: { view: Exclude<ViewType, 'agent'>; icon: typeof Code }[] = [
  { view: 'diff', icon: GitCompareArrows },
  { view: 'editor', icon: Code },
  { view: 'terminal', icon: SquareTerminal },
  { view: 'secrets', icon: KeyRound },
];

export function ViewSwitcher() {
  const activeAgentTile = useUIStore((s) => s.activeAgentTile);
  const secondaryChatId = useUIStore((s) => s.secondaryChatId);
  const openTabs = useUIStore((s) => s.openTabs);

  // Resolve active state against the exact tile toggleView() will act on, so the
  // highlight (and the close-on-click) tracks the focused pane in split-chat mode.
  const secondary = isSecondaryPaneActive(activeAgentTile, secondaryChatId);
  const openSet = useMemo(() => new Set(openTabs), [openTabs]);

  return (
    <div className="flex items-center gap-0.5">
      {SWITCHABLE_VIEWS.map(({ view, icon: Icon }) => {
        const isActive = openSet.has(viewTypeToTileId(view, secondary));
        return (
          <Button
            key={view}
            variant="unstyled"
            // Toggle: open the view as a full tab, or close it if already open.
            onClick={() => useUIStore.getState().toggleView(view, true)}
            className={cn(
              'rounded-md p-1.5 transition-colors duration-200',
              isActive
                ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
                : 'text-text-tertiary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-quaternary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
            )}
            aria-label={`Toggle ${VIEW_LABELS[view]} view`}
            aria-pressed={isActive}
            title={VIEW_LABELS[view]}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        );
      })}
    </div>
  );
}
