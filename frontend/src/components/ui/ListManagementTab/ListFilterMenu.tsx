import { Fragment, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersVertical, X } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FilterCategoryRow, FilterOptionRow } from '@/components/ui/FilterMenu/FilterMenu';
import menuStyles from '@/components/ui/FilterMenu/FilterMenu.module.scss';
import { FILTER_PANEL_WIDTH, FILTER_SUBMENU_WIDTH, useFilterMenu } from '@/hooks/useFilterMenu';
import styles from './ListFilterMenu.module.scss';

export interface ListFilterOption {
  id: string;
  name: string;
}

export interface ListFilterCategory {
  key: string;
  label: string;
  allLabel: string;
  value: string | null;
  groups: { heading: string | null; options: ListFilterOption[] }[];
  onChange: (id: string | null) => void;
}

interface ListFilterMenuProps {
  categories: ListFilterCategory[];
  onClear: () => void;
}

function selectedLabel(category: ListFilterCategory) {
  for (const group of category.groups) {
    const option = group.options.find((o) => o.id === category.value);
    if (option) return option.name;
  }
  return null;
}

export function ListFilterMenu({ categories, onClear }: ListFilterMenuProps) {
  const {
    isOpen,
    open,
    closeAll,
    submenu,
    openSubmenu,
    closeSubmenu,
    scheduleSubmenuClose,
    cancelSubmenuClose,
    triggerRef,
    panelRef,
    submenuRef,
  } = useFilterMenu<string>({ closeOnEscape: true });
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 0 });
  const summarizedCategories = categories.map((category) => ({
    category,
    summary: category.value === null ? 'All' : (selectedLabel(category) ?? '1 selected'),
  }));
  const activeCategories = summarizedCategories.filter(({ category }) => category.value !== null);
  const submenuCategory = categories.find((category) => category.key === submenu?.view);

  const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isOpen) {
      closeAll();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - FILTER_PANEL_WIDTH - 8)),
      maxHeight: window.innerHeight - rect.bottom - 14,
    });
    open();
  };

  const select = (category: ListFilterCategory, id: string | null) => {
    category.onChange(id);
    closeSubmenu();
  };

  return (
    <div className={styles.toolbar}>
      <div ref={triggerRef}>
        <Button
          variant="unstyled"
          onClick={handleToggle}
          aria-expanded={isOpen}
          className={clsx(styles.trigger, isOpen && styles['trigger--open'])}
        >
          <SlidersVertical className={styles.icon} />
          Filter
          {activeCategories.length > 0 && (
            <span className={styles.count}>{activeCategories.length}</span>
          )}
        </Button>
      </div>

      {activeCategories.map(({ category, summary }) => (
        <span key={category.key} className={styles.chip} title={`${category.label}: ${summary}`}>
          <span className={styles['chip-label']}>{summary}</span>
          <Button
            variant="unstyled"
            onClick={() => category.onChange(null)}
            aria-label={`Remove ${category.label.toLowerCase()} filter`}
            className={styles['chip-remove']}
          >
            <X className={styles.icon} />
          </Button>
        </span>
      ))}

      {isOpen &&
        createPortal(
          <>
            <div
              ref={panelRef}
              onMouseLeave={scheduleSubmenuClose}
              className={menuStyles.panel}
              style={{
                top: position.top,
                left: position.left,
                maxHeight: position.maxHeight,
                width: FILTER_PANEL_WIDTH,
              }}
            >
              {summarizedCategories.map(({ category, summary }) => (
                <FilterCategoryRow
                  key={category.key}
                  label={category.label}
                  summary={summary}
                  active={category.value !== null}
                  expanded={submenu?.view === category.key}
                  onOpen={(e) => openSubmenu(category.key, e)}
                  onLeave={scheduleSubmenuClose}
                />
              ))}
              {activeCategories.length > 0 && (
                <div className={menuStyles.divider}>
                  <Button variant="unstyled" onClick={onClear} className={menuStyles['clear-all']}>
                    Clear filters
                  </Button>
                </div>
              )}
            </div>

            {submenu && submenuCategory && (
              <div
                ref={submenuRef}
                onMouseEnter={cancelSubmenuClose}
                onMouseLeave={scheduleSubmenuClose}
                className={menuStyles.panel}
                style={{
                  top: submenu.top,
                  left: submenu.left,
                  maxHeight: submenu.maxHeight,
                  width: FILTER_SUBMENU_WIDTH,
                }}
              >
                <FilterOptionRow
                  selected={submenuCategory.value === null}
                  onSelect={() => select(submenuCategory, null)}
                >
                  {submenuCategory.allLabel}
                </FilterOptionRow>
                <div className={menuStyles.divider}>
                  {submenuCategory.groups.map((group, index) => (
                    <Fragment key={group.heading ?? index}>
                      {group.heading !== null && (
                        <div className={styles['group-heading']}>{group.heading}</div>
                      )}
                      {group.options.map((option) => (
                        <FilterOptionRow
                          key={option.id}
                          selected={submenuCategory.value === option.id}
                          onSelect={() => select(submenuCategory, option.id)}
                        >
                          <span className={menuStyles['option-name']}>{option.name}</span>
                        </FilterOptionRow>
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </>,
          document.body,
        )}
    </div>
  );
}
