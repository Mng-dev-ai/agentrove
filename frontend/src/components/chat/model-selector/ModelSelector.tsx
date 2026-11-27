import { memo, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Plus, Star } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Dropdown, type DropdownPosition } from '@/components/ui/primitives/Dropdown/Dropdown';
import type { DropdownItemType } from '@/components/ui/primitives/Dropdown/Dropdown';
import { useAuthStore } from '@/store/authStore';
import { useModelStore } from '@/store/modelStore';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { ProviderIconStack } from '@/components/ui/icons/ProviderIconStack';
import { AGENT_ICONS } from '@/components/ui/icons/providerIcons';
import { AgentFilterChips } from '@/components/chat/model-selector/AgentFilterChips';
import { formatNumberCompact } from '@/utils/format';
import type { AgentKind, Model } from '@/types/chat.types';
import styles from './ModelSelector.module.scss';

// Picks the members of a new thread: one tick is a chat, several a group thread.
export interface ModelChecklist {
  // One entry per member, so a model added twice appears twice
  memberModelIds: string[];
  onToggle: (modelId: string) => void;
  onAddAnother: (modelId: string) => void;
}

export interface ModelSelectorProps {
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  dropdownPosition?: DropdownPosition;
  disabled?: boolean;
  compact?: boolean;
  variant?: 'default' | 'text' | 'field';
  dropdownAlign?: 'left' | 'right';
  machineId?: string;
  onInlineSelect?: () => void;
  checklist?: ModelChecklist;
}

export const ModelSelector = memo(function ModelSelector({
  selectedModelId,
  onModelChange,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  compact = true,
  variant = 'default',
  machineId,
  onInlineSelect,
  checklist,
}: ModelSelectorProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: models = [], isLoading } = useModelsQuery({
    enabled: isAuthenticated,
    machineId,
  });
  const favoriteModelIds = useModelStore((state) => state.favoriteModelIds);

  const [agentFilter, setAgentFilter] = useState<AgentKind | null>(null);

  const memberModelIds = checklist?.memberModelIds;
  const filteredModels = useMemo(
    () =>
      models.filter(
        (m) =>
          !m.legacy ||
          m.model_id === selectedModelId ||
          favoriteModelIds.includes(m.model_id) ||
          memberModelIds?.includes(m.model_id),
      ),
    [models, selectedModelId, favoriteModelIds, memberModelIds],
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
  const memberCount = memberModelIds?.length ?? 0;
  const memberCounts = new Map<string, number>();
  for (const id of memberModelIds ?? []) memberCounts.set(id, (memberCounts.get(id) ?? 0) + 1);
  const isGroup = memberCount > 1;

  return (
    <Dropdown
      value={activeModel}
      items={groupedItems}
      getItemKey={(model) => model.model_id}
      getItemLabel={(model) => model.name}
      onSelect={(model) =>
        checklist ? checklist.onToggle(model.model_id) : onModelChange(model.model_id)
      }
      isItemSelected={checklist ? (model) => memberCounts.has(model.model_id) : undefined}
      closeOnSelect={!checklist}
      getItemShortLabel={
        isGroup
          ? () => `${memberCount} agents`
          : checklist && memberCount === 0
            ? () => 'Pick a model'
            : undefined
      }
      triggerLeading={
        isGroup && (
          <ProviderIconStack
            agentKinds={(memberModelIds ?? []).map(
              (id) => models.find((m) => m.model_id === id)?.agent_kind ?? activeModel.agent_kind,
            )}
          />
        )
      }
      leftIcon={isGroup ? undefined : activeIcon}
      ariaLabel="Model"
      width="16rem"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compact={compact}
      searchable
      searchPlaceholder="Filter..."
      searchVariant="underline"
      selectionStyle={checklist ? 'check' : 'accent'}
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
      onOpenChange={handleOpenChange}
      onInlineSelect={onInlineSelect}
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
        const count = memberCounts.get(model.model_id) ?? 0;
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
            {count > 1 && <span className={styles['item-count']}>×{count}</span>}
            {model.context_window != null && model.context_window > 0 && (
              <span className={styles['item-context']}>
                {formatNumberCompact(model.context_window)}
              </span>
            )}
            {checklist && count > 0 && (
              <FloatingTooltip content="Add another">
                <Button
                  type="button"
                  variant="unstyled"
                  aria-label={`Add another ${model.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    checklist.onAddAnother(model.model_id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.stopPropagation();
                    }
                  }}
                  className={styles['row-action']}
                >
                  <Plus className={styles['row-action-icon']} />
                </Button>
              </FloatingTooltip>
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
              className={clsx(styles['row-action'], isFavorite && styles['row-action--active'])}
            >
              <Star
                className={clsx(
                  styles['row-action-icon'],
                  isFavorite && styles['row-action-icon--active'],
                )}
              />
            </Button>
          </div>
        );
      }}
    />
  );
});
