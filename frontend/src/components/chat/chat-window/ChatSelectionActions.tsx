import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { MessageCircleQuestion, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { InlineAskPanel } from '@/components/chat/inline-ask/InlineAskPanel';
import { useUIStore, type ChatTextSelection } from '@/store/uiStore';
import styles from './ChatSelectionActions.module.scss';

// Must match .inline-ask width/max-width in InlineAskPanel.module.scss so the
// horizontal clamp keeps the panel inside the overflow-x-hidden scroller.
const PANEL_WIDTH = 440;
const PANEL_MAX_VIEWPORT_RATIO = 0.8;
const EDGE_GAP = 8;
// Half the toolbar's rendered width — it centers via translateX(-50%).
const TOOLBAR_HALF_WIDTH = 110;
// Keeps the toolbar (placed above the selection) from being clipped at the
// top of the scrollable content.
const TOOLBAR_CLEARANCE = 44;

// Selection geometry in scroller-content coordinates, so the toolbar and ask
// panel scroll with the message they anchor to (same feel as the editor's
// Monaco content widget).
interface SelectionAnchor {
  text: string;
  top: number;
  bottom: number;
  center: number;
  left: number;
}

interface ChatSelectionActionsProps {
  chatId: string | undefined;
  scrollerRef: RefObject<HTMLDivElement | null>;
}

// Floating "Add to chat" / "Ask" actions over text selected in rendered chat
// messages — the chat-page counterpart of the editor's selection actions.
export const ChatSelectionActions = memo(function ChatSelectionActions({
  chatId,
  scrollerRef,
}: ChatSelectionActionsProps) {
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const [ask, setAsk] = useState<{
    selection: ChatTextSelection;
    top: number;
    left: number;
    nonce: number;
  } | null>(null);
  const askInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // Both actions need a chat to target — without one there's nothing to attach
    // to or ask against, so don't track selections at all.
    if (!chatId) return;

    const evaluate = () => {
      const scroller = scrollerRef.current;
      const selection = document.getSelection();
      if (!scroller || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setAnchor(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const element = node instanceof Element ? node : node.parentElement;
      // Only selections fully inside message content — not the composer, find
      // bar, or this overlay's own toolbar/ask panel.
      if (!element || !scroller.contains(element) || element.closest('[data-selection-ui]')) {
        setAnchor(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        setAnchor(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const center = Math.min(
        Math.max(rect.left + rect.width / 2 - scrollerRect.left, TOOLBAR_HALF_WIDTH + EDGE_GAP),
        Math.max(scroller.clientWidth - TOOLBAR_HALF_WIDTH - EDGE_GAP, TOOLBAR_HALF_WIDTH),
      );
      setAnchor({
        text,
        top: Math.max(rect.top - scrollerRect.top + scroller.scrollTop, TOOLBAR_CLEARANCE),
        bottom: rect.bottom - scrollerRect.top + scroller.scrollTop,
        center,
        left: rect.left - scrollerRect.left,
      });
    };

    // Selection is final by pointerup; keyboard selection settles on Shift release.
    const handlePointerUp = () => evaluate();
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') evaluate();
    };
    const handleSelectionChange = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed) setAnchor(null);
    };
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [chatId, scrollerRef]);

  // Focus after the panel is in the DOM — keyed on nonce so re-asking from a
  // new selection refocuses the remounted panel.
  useLayoutEffect(() => {
    if (ask) askInputRef.current?.focus();
  }, [ask]);

  const handleAddToChat = () => {
    if (!chatId || !anchor) return;
    useUIStore.getState().addComposerSelection(chatId, { kind: 'chat', text: anchor.text });
    // Collapse so the chip is clear feedback and the toolbar doesn't linger.
    document.getSelection()?.removeAllRanges();
    setAnchor(null);
  };

  const handleAsk = () => {
    if (!anchor) return;
    const scroller = scrollerRef.current;
    const width = Math.min(PANEL_WIDTH, window.innerWidth * PANEL_MAX_VIEWPORT_RATIO);
    const maxLeft = scroller
      ? Math.max(EDGE_GAP, scroller.clientWidth - width - EDGE_GAP)
      : EDGE_GAP;
    setAsk((prev) => ({
      selection: { kind: 'chat', text: anchor.text },
      top: anchor.bottom,
      left: Math.min(Math.max(anchor.left, EDGE_GAP), maxLeft),
      // Nonce remounts the panel so a new selection starts a fresh question/answer.
      nonce: (prev?.nonce ?? 0) + 1,
    }));
    document.getSelection()?.removeAllRanges();
    setAnchor(null);
  };

  if (!chatId) return null;

  return (
    <div className={styles['selection-layer']}>
      {anchor && (
        <div
          className={styles.toolbar}
          data-selection-ui
          style={{ top: anchor.top, left: anchor.center }}
          // Keep the click from collapsing the selection before it lands.
          onMouseDown={(e) => e.preventDefault()}
        >
          <Button
            type="button"
            variant="unstyled"
            onClick={handleAddToChat}
            className={styles.action}
          >
            <MessageSquarePlus className={styles['action-icon']} />
            Add to chat
          </Button>
          <div className={styles.divider} />
          <Button type="button" variant="unstyled" onClick={handleAsk} className={styles.action}>
            <MessageCircleQuestion className={styles['action-icon']} />
            Ask
          </Button>
        </div>
      )}
      {ask && (
        <div
          key={ask.nonce}
          className={styles.ask}
          data-selection-ui
          style={{ top: ask.top, left: ask.left }}
        >
          <InlineAskPanel
            chatId={chatId}
            selection={ask.selection}
            inputRef={askInputRef}
            onClose={() => setAsk(null)}
          />
        </div>
      )}
    </div>
  );
});
