import { memo, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import type { DropdownItemType } from '@/components/ui/primitives/Dropdown/Dropdown';
import { useAuthStore } from '@/store/authStore';
import { useModelStore } from '@/store/modelStore';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { AGENT_ICONS } from '@/components/ui/icons/providerIcons';
import { AgentFilterChips } from '@/components/chat/model-selector/AgentFilterChips';
import { formatNumberCompact } from '@/utils/format';
import type { AgentKind, Model } from '@/types/chat.types';
import styles from './ModelSelector.module.scss';

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

  const [agentFilter, setAgentFilter] = useState<AgentKind | null>(null);

  const filteredModels = useMemo(
    () => (lockedAgentKind ? models.filter((m) => m.agent_kind === lockedAgentKind) : models),
    [models, lockedAgentKind],
  );

  const favoriteIdSet = useMemo(() => new Set(favoriteModelIds), [favoriteModelIds]);

  const agentKinds = useMemo(() => {
    const kinds: AgentKind[] = [];
    filteredModels.forEach((m) => {
      if (!kinds.includes(m.agent_kind)) kinds.push(m.agent_kind);
    });
    return kinds;
  }, [filteredModels]);

  const groupedItems = useMemo(() => {
    const visibleModels = agentFilter
      ? filteredModels.filter((m) => m.agent_kind === agentFilter)
      : filteredModels;
    // Favorites ordered by when each model was starred, not alphabetically.
    const modelById = new Map(visibleModels.map((m) => [m.model_id, m]));
    const favoriteModels = favoriteModelIds
      .map((id) => modelById.get(id))
      .filter((m): m is Model => m !== undefined);
    const restModels = visibleModels.filter((m) => !favoriteIdSet.has(m.model_id));

    const items: DropdownItemType<Model>[] = favoriteModels.map((model) => ({
      type: 'item',
      data: model,
    }));
    if (favoriteModels.length > 0 && restModels.length > 0) items.push({ type: 'divider' });
    restModels.forEach((model) => items.push({ type: 'item', data: model }));
    return items;
  }, [filteredModels, agentFilter, favoriteModelIds, favoriteIdSet]);

  // Reopen with the full list — a lingering agent filter would hide the selected model's row.
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) setAgentFilter(null);
  }, []);

  const selectedModel = filteredModels.find((m) => m.model_id === selectedModelId);

  if (isLoading) {
    return (
      <div className={styles.status}>
        <div className={styles['status-pill']} />
      </div>
    );
  }

  if (filteredModels.length === 0) {
    return (
      <div className={styles.status}>
        <span className={styles['status-text']}>No models</span>
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
      width="16rem"
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
      onOpenChange={handleOpenChange}
      renderHeader={
        agentKinds.length > 1
          ? () => (
              <AgentFilterChips
                agentKinds={agentKinds}
                value={agentFilter}
                onChange={setAgentFilter}
              />
            )
          : undefined
      }
      renderItem={(model, isSelected) => {
        const isFavorite = favoriteIdSet.has(model.model_id);
        return (
          <div className={styles.item}>
            <ProviderIcon agentKind={model.agent_kind} className={styles['item-icon']} />
            <FloatingTooltip content={model.name} className={styles['item-tooltip']}>
              <span
                className={clsx(styles['item-label'], isSelected && styles['item-label--selected'])}
              >
                {model.name}
              </span>
            </FloatingTooltip>
            {model.context_window != null && model.context_window > 0 && (
              <span className={styles['item-context']}>
                {formatNumberCompact(model.context_window)}
              </span>
            )}
            <Button
              type="button"
              variant="unstyled"
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isFavorite}
              onClick={(event) => {
                event.stopPropagation();
                useModelStore.getState().toggleFavoriteModel(model.model_id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation();
                }
              }}
              className={clsx(
                styles['favorite-button'],
                isFavorite && styles['favorite-button--active'],
              )}
            >
              <Star
                className={clsx(
                  styles['favorite-icon'],
                  isFavorite && styles['favorite-icon--active'],
                )}
              />
            </Button>
          </div>
        );
      }}
    />
  );
});
