import {
  memo,
  ReactElement,
  ReactNode,
  useState,
  useRef,
  KeyboardEvent,
  ComponentType,
  SVGProps,
} from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { useDropdown } from '@/hooks/useDropdown';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Button } from '@/components/ui/primitives/Button/Button';
import { SelectItem } from '@/components/ui/primitives/SelectItem/SelectItem';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { stateClasses } from '@/constants/stateClasses';
import styles from './Dropdown.module.scss';

export type DropdownItemType<T> = { type: 'item'; data: T } | { type: 'header'; label: string };

export interface DropdownProps<T> {
  value: T;
  items: readonly T[] | readonly DropdownItemType<T>[];
  getItemKey: (item: T) => string;
  getItemLabel: (item: T) => string;
  getItemShortLabel?: (item: T) => string;
  onSelect: (item: T) => void;
  renderItem?: (item: T, isSelected: boolean) => ReactNode;
  leftIcon?: ComponentType<SVGProps<SVGSVGElement>>;
  // CSS width for the panel (e.g. '10rem'), not a class name
  width?: string;
  itemClassName?: string;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
  compactOnMobile?: boolean;
  forceCompact?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchVariant?: 'boxed' | 'underline';
  selectionStyle?: 'check' | 'accent';
  renderFooter?: () => ReactNode;
  triggerVariant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

const isGroupedItems = <T,>(
  items: readonly T[] | readonly DropdownItemType<T>[],
): items is readonly DropdownItemType<T>[] => {
  return (
    items.length > 0 && typeof items[0] === 'object' && items[0] !== null && 'type' in items[0]
  );
};

function filterItems<T>(itemsToFilter: readonly T[], searchQuery: string): T[] {
  if (!searchQuery.trim()) return itemsToFilter as T[];
  const isStringItems = itemsToFilter.length > 0 && typeof itemsToFilter[0] === 'string';
  return fuzzySearch(searchQuery, [...itemsToFilter], {
    keys: isStringItems ? undefined : ['name', 'label'],
    limit: 50,
  });
}

function getFilteredGroupedItems<T>(
  items: readonly DropdownItemType<T>[],
  searchQuery: string,
): DropdownItemType<T>[] {
  if (!searchQuery.trim()) return [...items];

  const result: DropdownItemType<T>[] = [];
  let currentHeader: string | null = null;
  const pendingItems: T[] = [];

  for (const item of items) {
    if (item.type === 'header') {
      if (pendingItems.length > 0 && currentHeader) {
        const filtered = filterItems(pendingItems, searchQuery);
        if (filtered.length > 0) {
          result.push({ type: 'header', label: currentHeader });
          filtered.forEach((data) => result.push({ type: 'item', data }));
        }
      }
      currentHeader = item.label;
      pendingItems.length = 0;
    } else {
      pendingItems.push(item.data);
    }
  }

  if (pendingItems.length > 0 && currentHeader) {
    const filtered = filterItems(pendingItems, searchQuery);
    if (filtered.length > 0) {
      result.push({ type: 'header', label: currentHeader });
      filtered.forEach((data) => result.push({ type: 'item', data }));
    }
  }

  return result;
}

// Wraps flat items into the grouped format so both branches share one render path
function normalizeToGrouped<T>(
  items: readonly T[] | readonly DropdownItemType<T>[],
  searchQuery: string,
): DropdownItemType<T>[] {
  if (isGroupedItems(items)) {
    return getFilteredGroupedItems(items, searchQuery);
  }
  const filtered = filterItems(items as readonly T[], searchQuery);
  return filtered.map((data) => ({ type: 'item', data }));
}

function DropdownInner<T>({
  value,
  items,
  getItemKey,
  getItemLabel,
  getItemShortLabel,
  onSelect,
  renderItem,
  leftIcon: LeftIcon,
  width = '10rem',
  itemClassName,
  dropdownPosition = 'bottom',
  disabled = false,
  compactOnMobile = false,
  forceCompact = false,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchVariant = 'boxed',
  selectionStyle = 'check',
  renderFooter,
  triggerVariant = 'default',
  dropdownAlign = 'left',
}: DropdownProps<T>) {
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const [searchQuery, setSearchQuery] = useState('');
  const isMobile = useIsMobile();
  const prevIsOpenRef = useRef(isOpen);

  if (prevIsOpenRef.current !== isOpen) {
    prevIsOpenRef.current = isOpen;
    if (!isOpen) {
      setSearchQuery('');
    }
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (searchQuery) {
        setSearchQuery('');
      } else {
        setIsOpen(false);
      }
    }
  };

  const displayItems = normalizeToGrouped(items, searchQuery);

  const showIconOnly = (compactOnMobile || forceCompact) && LeftIcon;
  // Visibility lives on the tooltip wrapper (the flex item) so a hidden label doesn't
  // leave a zero-width slot that still consumes the trigger's gap in compact mode.
  const labelSlotClass = clsx(
    styles['label-slot'],
    showIconOnly && (forceCompact ? styles['label-slot--hidden'] : styles['label-slot--compact']),
  );

  const triggerLabel = getItemShortLabel ? getItemShortLabel(value) : getItemLabel(value);

  return (
    <div className={styles.dropdown} ref={dropdownRef}>
      <Button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        variant="unstyled"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={clsx(
          triggerVariant === 'text' ? styles['trigger-text'] : styles.trigger,
          isOpen && !disabled && stateClasses.OPEN,
        )}
      >
        {LeftIcon && (triggerVariant === 'text' ? showIconOnly : true) && (
          <LeftIcon
            className={clsx(
              styles['trigger-icon'],
              !forceCompact && styles['trigger-icon--responsive'],
            )}
          />
        )}
        <FloatingTooltip content={triggerLabel} className={labelSlotClass}>
          <span className={styles['trigger-label']}>{triggerLabel}</span>
        </FloatingTooltip>
        {triggerVariant !== 'text' && !disabled && (
          <ChevronDown
            className={clsx(
              styles.chevron,
              showIconOnly && !forceCompact && styles['chevron--responsive'],
              isOpen && stateClasses.OPEN,
            )}
          />
        )}
      </Button>

      {isOpen && !disabled && (
        <div
          role="listbox"
          style={{ width }}
          className={clsx(
            styles.panel,
            styles[`panel--${dropdownPosition}`],
            styles[`panel--${dropdownAlign}`],
          )}
        >
          {searchable && searchVariant === 'boxed' && (
            <div className={styles['search-box']}>
              <div className={styles['search-box-field']}>
                <Search className={styles['search-icon']} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={searchPlaceholder}
                  autoFocus={!isMobile}
                  className={styles['search-input']}
                />
                {searchQuery && (
                  <Button
                    onClick={() => setSearchQuery('')}
                    variant="unstyled"
                    aria-label="Clear search"
                    className={styles['search-clear']}
                  >
                    <X />
                  </Button>
                )}
              </div>
            </div>
          )}
          {searchable && searchVariant === 'underline' && (
            <div className={styles['search-underline']}>
              <Search className={styles['search-icon']} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                autoFocus={!isMobile}
                className={styles['search-underline-input']}
              />
              {searchQuery && (
                <Button
                  onClick={() => setSearchQuery('')}
                  variant="unstyled"
                  aria-label="Clear search"
                  className={styles['search-underline-clear']}
                >
                  <X />
                </Button>
              )}
            </div>
          )}
          <div className={styles.items}>
            {displayItems.map((entry, index) => {
              if (entry.type === 'header') {
                return (
                  <div
                    key={`header-${entry.label}`}
                    className={clsx(
                      styles['group-header'],
                      index !== 0 && styles['group-header--divided'],
                    )}
                  >
                    {entry.label}
                  </div>
                );
              }

              const item = entry.data;
              const isSelected = getItemKey(item) === getItemKey(value);
              return (
                <SelectItem
                  key={getItemKey(item)}
                  isSelected={isSelected}
                  role="option"
                  onSelect={() => {
                    onSelect(item);
                    setIsOpen(false);
                  }}
                  className={clsx(
                    styles['item-row'],
                    selectionStyle === 'accent' && styles['item-row--accent'],
                  )}
                >
                  {selectionStyle === 'check' && (
                    <Check
                      className={clsx(
                        styles['item-check'],
                        isSelected && styles['item-check--selected'],
                      )}
                    />
                  )}
                  {selectionStyle === 'accent' && isSelected && (
                    <div className={styles['item-accent']} />
                  )}
                  <div className={clsx(styles['item-content'], itemClassName)}>
                    {renderItem ? (
                      renderItem(item, isSelected)
                    ) : (
                      <FloatingTooltip
                        content={getItemLabel(item)}
                        className={styles['item-content']}
                      >
                        <span
                          className={clsx(
                            styles['item-label'],
                            isSelected && styles['item-label--selected'],
                          )}
                        >
                          {getItemLabel(item)}
                        </span>
                      </FloatingTooltip>
                    )}
                  </div>
                </SelectItem>
              );
            })}
          </div>
          {renderFooter?.()}
        </div>
      )}
    </div>
  );
}

export const Dropdown = memo(DropdownInner) as <T>(props: DropdownProps<T>) => ReactElement;
