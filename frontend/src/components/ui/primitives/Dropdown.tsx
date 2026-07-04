import { memo, ReactNode, useState, useRef, KeyboardEvent, ComponentType, SVGProps } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useDropdown } from '@/hooks/useDropdown';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Button } from '@/components/ui/primitives/Button';
import { SelectItem } from '@/components/ui/primitives/SelectItem';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { cn } from '@/utils/cn';

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
  width = 'w-40',
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
  const labelVisibility = showIconOnly ? (forceCompact ? 'hidden' : 'hidden sm:block') : '';
  const labelClasses =
    'truncate text-2xs font-medium text-text-secondary dark:text-text-dark-secondary';
  const chevronClasses = showIconOnly
    ? forceCompact
      ? 'hidden'
      : 'hidden sm:block h-3 w-3 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary transition-transform duration-200'
    : 'h-3 w-3 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary transition-transform duration-200';

  const triggerLabel = getItemShortLabel ? getItemShortLabel(value) : getItemLabel(value);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        variant="unstyled"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={
          triggerVariant === 'text'
            ? `flex min-w-0 items-center gap-1 p-0 text-2xs leading-normal transition-colors duration-200 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-text-primary dark:hover:text-text-dark-primary'} ${isOpen ? 'text-text-primary dark:text-text-dark-primary' : 'text-text-secondary dark:text-text-dark-secondary'}`
            : `flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors duration-200 ${isOpen && !disabled ? 'bg-surface-hover dark:bg-surface-dark-hover' : 'hover:bg-surface-hover/60 dark:hover:bg-surface-dark-hover/60'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`
        }
      >
        {triggerVariant === 'text' ? (
          <>
            {/* Keep the text trigger responsive so the composer row still collapses in split/mobile layouts. */}
            {showIconOnly && LeftIcon && (
              <LeftIcon
                className={cn(
                  'h-3 w-3 flex-shrink-0 text-current',
                  forceCompact ? '' : 'sm:hidden',
                )}
              />
            )}
            <FloatingTooltip content={triggerLabel} className={cn('min-w-0', labelVisibility)}>
              <span className={cn(labelClasses, 'text-inherit dark:text-inherit')}>
                {triggerLabel}
              </span>
            </FloatingTooltip>
          </>
        ) : (
          <>
            {LeftIcon && (
              <LeftIcon
                className={cn(
                  'h-3 w-3 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary',
                  !forceCompact && 'sm:hidden',
                )}
              />
            )}
            <FloatingTooltip content={triggerLabel} className={cn('min-w-0', labelVisibility)}>
              <span className={labelClasses}>{triggerLabel}</span>
            </FloatingTooltip>
            {!disabled && (
              <ChevronDown className={`${chevronClasses} ${isOpen ? 'rotate-180' : ''}`} />
            )}
          </>
        )}
      </Button>

      {isOpen && !disabled && (
        <div
          role="listbox"
          className={`absolute ${dropdownAlign === 'right' ? 'right-0' : 'left-0'} ${width} z-[60] rounded-xl border border-border bg-surface-secondary/95 shadow-medium backdrop-blur-xl backdrop-saturate-150 dark:border-border-dark dark:bg-surface-dark-secondary/95 dark:shadow-black/40 ${dropdownPosition === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          {searchable && searchVariant === 'boxed' && (
            <div className="border-b border-border p-1.5 dark:border-border-dark">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2 h-3 w-3 text-text-quaternary dark:text-text-dark-quaternary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={searchPlaceholder}
                  autoFocus={!isMobile}
                  className="h-7 w-full rounded-lg border border-border bg-surface-tertiary py-1 pl-7 pr-7 text-2xs text-text-primary transition-colors duration-200 placeholder:text-text-quaternary focus:border-border-hover focus:outline-none dark:border-border-dark dark:bg-surface-dark-tertiary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus:border-border-dark-hover"
                />
                {searchQuery && (
                  <Button
                    onClick={() => setSearchQuery('')}
                    variant="unstyled"
                    aria-label="Clear search"
                    className="absolute right-1 rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:bg-surface-hover hover:text-text-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-secondary"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          )}
          {searchable && searchVariant === 'underline' && (
            <div className="flex items-center gap-1.5 border-b border-border/50 px-2.5 py-1.5 dark:border-border-dark/50">
              <Search className="h-3 w-3 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                autoFocus={!isMobile}
                className="h-6 w-full bg-transparent text-2xs text-text-primary placeholder:text-text-quaternary focus:outline-none dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary"
              />
              {searchQuery && (
                <Button
                  onClick={() => setSearchQuery('')}
                  variant="unstyled"
                  aria-label="Clear search"
                  className="rounded-md p-0.5 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:hover:text-text-dark-secondary"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
          <div className="max-h-64 space-y-px overflow-y-auto p-1">
            {displayItems.map((entry, index) => {
              if (entry.type === 'header') {
                return (
                  <div
                    key={`header-${entry.label}`}
                    className={`px-2 pb-0.5 pt-1.5 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary ${index === 0 ? '' : 'mt-1 border-t border-border dark:border-border-dark'}`}
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
                  className={cn(
                    'relative flex items-center gap-2',
                    selectionStyle === 'accent' && 'pl-2.5',
                  )}
                >
                  {selectionStyle === 'check' && (
                    <Check
                      className={`h-3 w-3 flex-shrink-0 transition-opacity duration-150 ${isSelected ? 'text-text-primary opacity-100 dark:text-text-dark-primary' : 'opacity-0'}`}
                    />
                  )}
                  {selectionStyle === 'accent' && isSelected && (
                    <div className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-text-primary dark:bg-text-dark-primary" />
                  )}
                  <div className={`min-w-0 flex-1${itemClassName ? ` ${itemClassName}` : ''}`}>
                    {renderItem ? (
                      renderItem(item, isSelected)
                    ) : (
                      <FloatingTooltip content={getItemLabel(item)} className="min-w-0">
                        <span
                          className={`block truncate text-2xs font-medium ${
                            isSelected
                              ? 'text-text-primary dark:text-text-dark-primary'
                              : 'text-text-secondary dark:text-text-dark-secondary'
                          }`}
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

export const Dropdown = memo(DropdownInner) as <T>(props: DropdownProps<T>) => JSX.Element;
