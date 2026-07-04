import { memo, useMemo } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Dropdown } from '@/components/ui/primitives/Dropdown';
import type { DropdownItemType } from '@/components/ui/primitives/Dropdown';
import { useAuthStore } from '@/store/authStore';
import { useModelStore } from '@/store/modelStore';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import { AGENT_ICONS } from '@/components/ui/icons/ProviderIcon';
import { cn } from '@/utils/cn';
import { formatNumberCompact } from '@/utils/format';
import type { AgentKind, Model } from '@/types/chat.types';

const FAVORITES_LABEL = 'Favorites';

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

export interface ModelSelectorProps {
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
  compact?: boolean;
  lockedAgentKind?: AgentKind | null;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export const ModelSelector = memo(function ModelSelector({
  selectedModelId,
  onModelChange,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  compact,
  lockedAgentKind,
  variant = 'default',
}: ModelSelectorProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isSplitMode = useIsSplitMode();
  // Read-only models query — useModelSelection would run the per-chat defaulting
  // effect and persist models[0] before the owner derives the model from history.
  const { data: models = [], isLoading } = useModelsQuery({ enabled: isAuthenticated });
  const favoriteModelIds = useModelStore((state) => state.favoriteModelIds);

  const filteredModels = useMemo(
    () => (lockedAgentKind ? models.filter((m) => m.agent_kind === lockedAgentKind) : models),
    [models, lockedAgentKind],
  );

  const favoriteIdSet = useMemo(() => new Set(favoriteModelIds), [favoriteModelIds]);

  const groupedItems = useMemo(() => {
    const items: DropdownItemType<Model>[] = [];
    // Favorites ordered by when each model was starred, not alphabetically.
    const modelById = new Map(filteredModels.map((m) => [m.model_id, m]));
    const favoriteModels = favoriteModelIds
      .map((id) => modelById.get(id))
      .filter((m): m is Model => m !== undefined);
    if (favoriteModels.length > 0) {
      items.push({ type: 'header', label: FAVORITES_LABEL });
      favoriteModels.forEach((model) => items.push({ type: 'item', data: model }));
    }

    const groups = new Map<AgentKind, Model[]>();
    filteredModels.forEach((model) => {
      if (favoriteIdSet.has(model.model_id)) return;
      const list = groups.get(model.agent_kind) ?? [];
      list.push(model);
      groups.set(model.agent_kind, list);
    });

    groups.forEach((agentModels, kind) => {
      items.push({ type: 'header', label: AGENT_LABELS[kind] ?? kind });
      agentModels.forEach((model) => {
        items.push({ type: 'item', data: model });
      });
    });
    return items;
  }, [filteredModels, favoriteModelIds, favoriteIdSet]);

  const selectedModel = filteredModels.find((m) => m.model_id === selectedModelId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1">
        <div className="h-3.5 w-16 animate-pulse rounded-full bg-text-quaternary/20" />
      </div>
    );
  }

  if (filteredModels.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1">
        <span className="text-xs text-text-quaternary">No models</span>
      </div>
    );
  }

  const activeModel = selectedModel || filteredModels[0];
  const activeIcon = AGENT_ICONS[activeModel.agent_kind];

  return (
    <Dropdown
      value={activeModel}
      items={groupedItems}
      getItemKey={(model) => model.model_id}
      getItemLabel={(model) => model.name}
      onSelect={(model) => onModelChange(model.model_id)}
      leftIcon={activeIcon}
      width="w-64"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile={compact ?? true}
      forceCompact={compact ?? isSplitMode}
      searchable
      searchPlaceholder="Filter..."
      searchVariant="underline"
      selectionStyle="accent"
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
      renderItem={(model, isSelected) => {
        const isFavorite = favoriteIdSet.has(model.model_id);
        return (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-2xs font-medium',
                isSelected
                  ? 'text-text-primary dark:text-text-dark-primary'
                  : 'text-text-secondary dark:text-text-dark-secondary',
              )}
              title={model.name}
            >
              {model.name}
            </span>
            {model.context_window != null && model.context_window > 0 && (
              <span className="flex-shrink-0 rounded-md bg-surface-tertiary px-1.5 py-0.5 text-2xs font-medium text-text-quaternary dark:bg-surface-dark-tertiary dark:text-text-dark-quaternary">
                {formatNumberCompact(model.context_window)}
              </span>
            )}
            <Button
              type="button"
              variant="unstyled"
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isFavorite}
              onClick={(event) => {
                // Stop the row's onClick from selecting the model when the star is clicked.
                event.stopPropagation();
                useModelStore.getState().toggleFavoriteModel(model.model_id);
              }}
              onKeyDown={(event) => {
                // Keep the row's Enter/Space handler from firing in addition to this button's.
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation();
                }
              }}
              className={cn(
                'flex flex-shrink-0 items-center justify-center rounded-md p-0.5 transition-colors duration-150',
                isFavorite
                  ? 'text-text-primary dark:text-text-dark-primary'
                  : 'text-text-quaternary hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-primary',
              )}
            >
              <Star className={cn('h-3 w-3', isFavorite && 'fill-current')} />
            </Button>
          </div>
        );
      }}
    />
  );
});
