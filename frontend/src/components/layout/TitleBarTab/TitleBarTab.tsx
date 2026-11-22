import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { stateClasses } from '@/config/stateClasses';
import styles from './TitleBarTab.module.scss';

// The strip's scroll padding is its fade width, so a revealed tab clears the fade.
function offsetFromView(strip: HTMLElement, tab: Element): number {
  const fade = parseFloat(getComputedStyle(strip).scrollPaddingInlineStart);
  const stripRect = strip.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  const start = stripRect.left + (strip.scrollLeft > 0 ? fade : 0);
  const end =
    stripRect.right - (strip.scrollLeft + strip.clientWidth < strip.scrollWidth ? fade : 0);
  if (tabRect.left < start) return tabRect.left - start;
  if (tabRect.right > end) return Math.min(tabRect.right - end, tabRect.left - start);
  return 0;
}

function activeTab(strip: HTMLElement): Element | null {
  return strip.querySelector(`:scope > .${stateClasses.ACTIVE}`);
}

function markHiddenEdges(strip: HTMLElement) {
  const hiddenEnd = strip.scrollWidth - strip.clientWidth - strip.scrollLeft;
  strip.toggleAttribute('data-hidden-start', strip.scrollLeft > 1);
  strip.toggleAttribute('data-hidden-end', hiddenEnd > 1);
}

// Keeps the active tab in view until the user scrolls it out.
export function TitleBarTabs({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const shownActiveRef = useRef<Element | null>(null);
  const followRef = useRef(true);
  const revealedScrollRef = useRef<number | null>(null);

  const revealActiveTab = (strip: HTMLElement) => {
    const tab = activeTab(strip);
    if (tab) strip.scrollLeft += offsetFromView(strip, tab);
    followRef.current = true;
    revealedScrollRef.current = strip.scrollLeft;
  };

  useLayoutEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const observer = new ResizeObserver((entries) => {
      if (followRef.current || entries.some((entry) => entry.target === strip)) {
        revealActiveTab(strip);
      }
      markHiddenEdges(strip);
    });
    observer.observe(strip);
    observerRef.current = observer;
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    for (const tab of strip.children) observerRef.current?.observe(tab);
    const tab = activeTab(strip);
    if (tab !== shownActiveRef.current) {
      shownActiveRef.current = tab;
      revealActiveTab(strip);
    }
    markHiddenEdges(strip);
  });

  const handleScroll = (strip: HTMLElement) => {
    markHiddenEdges(strip);
    // The scroll a reveal caused can land after tabs grew; only the user's scroll unfollows.
    if (strip.scrollLeft === revealedScrollRef.current) return;
    const tab = activeTab(strip);
    followRef.current = !tab || Math.abs(offsetFromView(strip, tab)) < 1;
  };

  return (
    <div ref={ref} className={styles.tabs} onScroll={(e) => handleScroll(e.currentTarget)}>
      {children}
    </div>
  );
}

interface TitleBarTabActions {
  tooltip: string;
  isCurrent: boolean;
  onSelect: () => void;
  onClose: () => void;
}

interface TitleBarTabProps {
  icon: ReactNode;
  title: string;
  isActive: boolean;
  menu: ReactNode;
  actions: TitleBarTabActions;
}

export function TitleBarTab({ icon, title, isActive, menu, actions }: TitleBarTabProps) {
  return (
    <div
      // Middle-click closes (browser/editor tab convention).
      onAuxClick={(e) => {
        if (e.button === 1) actions.onClose();
      }}
      className={clsx(
        styles.tab,
        menu && styles['tab--with-menu'],
        isActive && stateClasses.ACTIVE,
      )}
    >
      <FloatingTooltip content={actions.tooltip} className={styles['tab-tooltip']}>
        <Button
          variant="unstyled"
          onClick={actions.onSelect}
          aria-current={actions.isCurrent ? 'page' : undefined}
          className={styles['tab-select']}
        >
          {icon}
          <span className={styles['tab-title']}>{title}</span>
        </Button>
      </FloatingTooltip>
      {menu}
      {/* Close stays focusable (opacity-0) so keyboard users can still reach it. */}
      <Button
        variant="unstyled"
        onClick={actions.onClose}
        className={styles['tab-close']}
        aria-label={`Close ${title} tab`}
      >
        <X className={styles['close-icon']} />
      </Button>
    </div>
  );
}
