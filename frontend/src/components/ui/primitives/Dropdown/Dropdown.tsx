import {
  memo,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
  useRef,
  KeyboardEvent,
  ComponentType,
  SVGProps,
} from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { useDropdown } from '@/hooks/useDropdown';
import { usePanelFit, usePanelInlineShift } from '@/hooks/usePanelFit';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import { Button } from '@/components/ui/primitives/Button/Button';
import { SelectItem } from '@/components/ui/primitives/SelectItem/SelectItem';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { stateClasses } from '@/config/stateClasses';
import styles from './Dropdown.module.scss';

export type DropdownItemType<T> =
  | { type: 'item'; data: T }
  | { type: 'header'; label: string }
  | { type: 'divider' };

export type DropdownPosition = 'top' | 'bottom' | 'auto';

export interface DropdownProps<T> {
  value: T;
  items: readonly T[] | readonly DropdownItemType<T>[];
  getItemKey: (item: T) => string;
  getItemLabel: (item: T) => string;
  getItemShortLabel?: (item: T) => string;
  // Kept whole after the label, which truncates first
  triggerSuffix?: string;
  onSelect: (item: T) => void;
  renderItem?: (item: T, isSelected: boolean) => ReactNode;
  leftIcon?: ComponentType<SVGProps<SVGSVGElement>>;
  // CSS width for the panel (e.g. '10rem'), not a class name
  width?: string;
  itemClassName?: string;
  dropdownPosition?: DropdownPosition;
  disabled?: boolean;
  // leftIcon stands in for the label on phones and in split panes
  compact?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchVariant?: 'boxed' | 'underline';
  selectionStyle?: 'check' | 'accent';
  renderHeader?: () => ReactNode;
  renderFooter?: () => ReactNode;
  onOpenChange?: (isOpen: boolean) => void;
  // 'toolbar' matches ToggleDropdown's composer-toolbar trigger (icon always shown);
  // 'field' is a full-width bordered control matching Select in forms.
  triggerVariant?: 'default' | 'text' | 'toolbar' | 'field';
  // Show leftIcon beside the label at every width, not only in compact mode
  iconWithLabel?: boolean;
  dropdownAlign?: 'left' | 'right';
  ariaLabel?: string;
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

  // Search results render flat: a header survives only when its group has matches,
  // headerless groups keep their matches, and dividers drop.
  const result: DropdownItemType<T>[] = [];
  let currentHeader: string | null = null;
  const pendingItems: T[] = [];

  const flushGroup = () => {
    if (pendingItems.length === 0) return;
    const filtered = filterItems(pendingItems, searchQuery);
    if (filtered.length > 0) {
      if (currentHeader) result.push({ type: 'header', label: currentHeader });
      filtered.forEach((data) => result.push({ type: 'item', data }));
    }
    pendingItems.length = 0;
  };

  for (const item of items) {
    if (item.type === 'item') {
      pendingItems.push(item.data);
    } else {
      flushGroup();
      currentHeader = item.type === 'header' ? item.label : null;
    }
  }
  flushGroup();

  return result;
}

// Code points of a toolbar label that never wrap, so the shrinking trigger keeps about
// five characters plus the ellipsis (see .trigger-label-head)
const TOOLBAR_LABEL_HEAD_LENGTH = 7;

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

const TRIGGER_CLASSES = {
  default: styles.trigger,
  text: styles['trigger-text'],
  toolbar: styles['trigger-toolbar'],
  field: styles['trigger-field'],
};

const Dropdown = memo(function Dropdown<T>({
  value,
  items,
  getItemKey,
  getItemLabel,
  getItemShortLabel,
  triggerSuffix,
  onSelect,
  renderItem,
  leftIcon: LeftIcon,
  width = '10rem',
  itemClassName,
  dropdownPosition = 'bottom',
  disabled = false,
  compact = false,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchVariant = 'boxed',
  selectionStyle = 'check',
  renderHeader,
  renderFooter,
  onOpenChange,
  triggerVariant = 'default',
  iconWithLabel = false,
  dropdownAlign = 'left',
  ariaLabel,
}: DropdownProps<T>) {
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const panelRef = useRef<HTMLDivElement>(null);
  const fit = usePanelFit(dropdownRef, panelRef, isOpen && !disabled, dropdownPosition === 'auto');
  const panelTransform = usePanelInlineShift(panelRef, isOpen && !disabled);
  const panelSide = dropdownPosition === 'auto' ? (fit?.side ?? 'bottom') : dropdownPosition;
  const [searchQuery, setSearchQuery] = useState('');
  const isMobile = useIsMobile();
  const isSplitMode = useIsSplitMode();
  const prevIsOpenRef = useRef(isOpen);

  if (prevIsOpenRef.current !== isOpen) {
    prevIsOpenRef.current = isOpen;
    if (!isOpen) {
      setSearchQuery('');
    }
  }

  // Parent-owned state can't be written from the render check above — notify via effect
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // An empty query lets Escape through to useDropdown, which closes the panel.
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
    } else if (event.key === 'Escape' && searchQuery) {
      event.preventDefault();
      setSearchQuery('');
    }
  };

  const displayItems = normalizeToGrouped(items, searchQuery);

  const showIconOnly = compact && LeftIcon;
  const forceCompact = compact && isSplitMode;
  // Visibility lives on the tooltip wrapper (the flex item) so a hidden label doesn't
  // leave a zero-width slot that still consumes the trigger's gap in compact mode.
  const labelSlotClass = clsx(
    styles['label-slot'],
    showIconOnly && (forceCompact ? styles['label-slot--hidden'] : styles['label-slot--compact']),
  );

  const triggerLabel = getItemShortLabel ? getItemShortLabel(value) : getItemLabel(value);
  const triggerLabelChars = Array.from(triggerLabel);

  return (
    <div className={styles.dropdown} ref={dropdownRef}>
      <Button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        variant="unstyled"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={
          ariaLabel && `${ariaLabel}: ${triggerLabel}${triggerSuffix ? ` ${triggerSuffix}` : ''}`
        }
        className={clsx(TRIGGER_CLASSES[triggerVariant], isOpen && !disabled && stateClasses.OPEN)}
      >
        {LeftIcon && (triggerVariant === 'text' ? showIconOnly || iconWithLabel : true) && (
          <LeftIcon
            className={clsx(
              styles['trigger-icon'],
              !forceCompact &&
                triggerVariant !== 'toolbar' &&
                triggerVariant !== 'field' &&
                !iconWithLabel &&
                styles['trigger-icon--responsive'],
            )}
          />
        )}
        <FloatingTooltip content={isOpen ? '' : triggerLabel} className={labelSlotClass}>
          <span className={styles['trigger-label']}>
            {triggerVariant === 'toolbar' ? (
              <>
                <span className={styles['trigger-label-head']}>
                  {triggerLabelChars.slice(0, TOOLBAR_LABEL_HEAD_LENGTH).join('')}
                </span>
                {triggerLabelChars.slice(TOOLBAR_LABEL_HEAD_LENGTH).join('')}
              </>
            ) : (
              triggerLabel
            )}
          </span>
        </FloatingTooltip>
        {triggerSuffix && <span className={styles['trigger-suffix']}>{triggerSuffix}</span>}
        {triggerVariant !== 'text' && !disabled && (
          <ChevronDown
            className={clsx(
              styles.chevron,
              showIconOnly &&
                !forceCompact &&
                triggerVariant !== 'toolbar' &&
                styles['chevron--responsive'],
              isOpen && stateClasses.OPEN,
            )}
          />
        )}
      </Button>

      {isOpen && !disabled && (
        <div
          ref={panelRef}
          role="listbox"
          style={{
            width,
            maxHeight: fit?.maxHeight,
            transform: panelTransform,
          }}
          className={clsx(
            styles.panel,
            styles[`panel--${panelSide}`],
            styles[`panel--${dropdownAlign}`],
            fit?.maxHeight !== undefined && styles['panel--capped'],
          )}
        >
          {renderHeader?.()}
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
                    type="button"
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
                  type="button"
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
              if (entry.type === 'divider') {
                return <div key={`divider-${index}`} role="separator" className={styles.divider} />;
              }
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
}) as <T>(props: DropdownProps<T>) => ReactElement;

export { Dropdown };
