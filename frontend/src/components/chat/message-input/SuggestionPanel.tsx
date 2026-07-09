import { type ReactNode, memo, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';

interface SuggestionSection<T> {
  label?: string;
  items: T[];
  itemKey: (item: T) => string;
  itemClassName?: string;
  renderItem: (item: T, isActive: boolean) => ReactNode;
}

interface SuggestionPanelProps<T> {
  sections: SuggestionSection<T>[];
  highlightedIndex: number;
  onSelect: (item: T) => void;
}

function SuggestionPanelInner<T>({
  sections,
  highlightedIndex,
  onSelect,
}: SuggestionPanelProps<T>) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  itemRefs.current.length = totalItems;

  const sectionOffsets = useMemo(
    () =>
      sections.reduce<number[]>((acc, s, i) => {
        acc.push(i === 0 ? 0 : acc[i - 1] + sections[i - 1].items.length);
        return acc;
      }, []),
    [sections],
  );

  useEffect(() => {
    if (highlightedIndex >= 0 && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [highlightedIndex]);

  if (totalItems === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-40 mb-2">
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-surface shadow-sm dark:border-border-dark dark:bg-surface-dark">
        <div className="py-1" role="listbox">
          {sections.map((section, sectionIdx) => {
            if (section.items.length === 0) return null;
            const offset = sectionOffsets[sectionIdx];
            return (
              <div key={section.label ?? sectionIdx}>
                {section.label && (
                  <div className="px-3 py-1 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
                    {section.label}
                  </div>
                )}
                {section.items.map((item, itemIdx) => {
                  const globalIdx = offset + itemIdx;
                  const isActive = globalIdx === highlightedIndex;
                  return (
                    <Button
                      key={section.itemKey(item)}
                      ref={(el) => {
                        itemRefs.current[globalIdx] = el;
                      }}
                      type="button"
                      variant="unstyled"
                      role="option"
                      aria-selected={isActive}
                      className={`flex w-full items-center text-left ${section.itemClassName ?? 'gap-2 px-3 py-1.5'} ${
                        isActive
                          ? 'bg-surface-active dark:bg-surface-dark-active'
                          : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover'
                      }`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onSelect(item);
                      }}
                    >
                      {section.renderItem(item, isActive)}
                    </Button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const SuggestionPanel = memo(SuggestionPanelInner) as typeof SuggestionPanelInner;
