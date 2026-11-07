import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { FileDiffMetadata } from '@pierre/diffs';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest('input, textarea, select');
}

export interface DiffShortcut {
  key: string;
  label: string;
  run: () => void;
}

// Single-key shortcuts, live only while the diff view holds focus. Clicking the
// diff body leaves focus on <body> (its rows aren't focusable), so a pointerdown
// inside the view also counts until the next pointerdown elsewhere.
interface UseDiffShortcutsParams {
  rootRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  files: FileDiffMetadata[];
  currentFile: string | null;
  jumpToFile: (name: string) => void;
  toggleViewed: (name: string) => void;
  canComment: boolean;
  openComposer: () => void;
  toggleShortcutsHelp: () => void;
}

export function useDiffShortcuts({
  rootRef,
  enabled,
  files,
  currentFile,
  jumpToFile,
  toggleViewed,
  canComment,
  openComposer,
  toggleShortcutsHelp,
}: UseDiffShortcutsParams): DiffShortcut[] {
  const pointerInsideRef = useRef(false);

  const stepFile = useCallback(
    (offset: number) => {
      const index = files.findIndex((f) => f.name === currentFile);
      const next = files[index + offset];
      if (next) jumpToFile(next.name);
    },
    [files, currentFile, jumpToFile],
  );

  const shortcuts = useMemo<DiffShortcut[]>(
    () => [
      { key: 'j', label: 'Next file', run: () => stepFile(1) },
      { key: 'k', label: 'Previous file', run: () => stepFile(-1) },
      {
        key: 'v',
        label: 'Toggle viewed',
        run: () => {
          if (currentFile) toggleViewed(currentFile);
        },
      },
      ...(canComment ? [{ key: 'c', label: 'Comment on selected lines', run: openComposer }] : []),
      { key: '?', label: 'Show shortcuts', run: toggleShortcutsHelp },
    ],
    [stepFile, currentFile, toggleViewed, canComment, openComposer, toggleShortcutsHelp],
  );

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      pointerInsideRef.current = !!rootRef.current?.contains(event.target as Node);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const shortcut = shortcuts.find((s) => s.key === event.key);
      if (!shortcut || isEditable(event.target)) return;
      const root = rootRef.current;
      const active = document.activeElement;
      const focusInside =
        !!root && (root.contains(active) || (active === document.body && pointerInsideRef.current));
      if (!focusInside) return;
      event.preventDefault();
      shortcut.run();
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, rootRef, shortcuts]);

  return shortcuts;
}
