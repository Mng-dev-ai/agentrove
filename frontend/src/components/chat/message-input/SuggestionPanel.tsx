import { type ReactNode, memo, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './SuggestionPanel.module.scss';

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
      sections.reduce<number[]>((acc, _section, i) => {
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
    <div className={styles['suggestion-panel']}>
      <div className={styles['panel-scroll']}>
        <div className={styles.list} role="listbox">
          {sections.map((section, sectionIdx) => {
            if (section.items.length === 0) return null;
            const offset = sectionOffsets[sectionIdx];
            return (
              <div key={section.label ?? sectionIdx}>
                {section.label && <div className={styles['section-label']}>{section.label}</div>}
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
                      className={clsx(
                        styles.item,
                        section.itemClassName ?? styles['item--default'],
                        isActive && styles['item--active'],
                      )}
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
