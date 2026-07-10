import { memo, Suspense } from 'react';
import { LazyMarkDown } from '@/components/ui/markdown/LazyMarkDown';
import { useSmoothText } from '@/hooks/useSmoothText';
import { ThinkingBlock } from './ThinkingBlock';
import { PromptSuggestions } from './PromptSuggestions';
import { getToolComponent } from '@/components/chat/tools/registry';
import type { MessageSegment } from './segmentBuilder';
import type { AgentKind } from '@/types/chat.types';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import styles from './SegmentView.module.scss';

interface SegmentViewProps {
  segment: MessageSegment;
  chatId?: string;
  agentKind?: AgentKind;
  isActiveThinking: boolean;
  isActiveText: boolean;
  isLastBotMessage: boolean;
  onSuggestionSelect?: (suggestion: string) => void;
  highlightMentions?: boolean;
}

const TextSegment = ({
  text,
  isActive,
  highlightMentions,
}: {
  text: string;
  isActive: boolean;
  highlightMentions?: boolean;
}) => {
  // The segment receiving stream output reveals its text word-by-word instead
  // of jumping a flush-sized chunk at a time.
  const smoothText = useSmoothText(text, isActive);
  return (
    <div className={styles['text-segment']}>
      <LazyMarkDown
        content={smoothText}
        streaming={isActive}
        highlightMentions={highlightMentions}
      />
    </div>
  );
};

export const SegmentView = memo(function SegmentView({
  segment,
  chatId,
  agentKind,
  isActiveThinking,
  isActiveText,
  isLastBotMessage,
  onSuggestionSelect,
  highlightMentions,
}: SegmentViewProps) {
  // Memoized so stream flushes only re-render segments whose object identity
  // changed — MessageRenderer keeps unchanged segments referentially stable.
  switch (segment.kind) {
    case 'text':
      return (
        <TextSegment
          text={segment.text}
          isActive={isActiveText}
          highlightMentions={highlightMentions}
        />
      );
    case 'thinking':
      return (
        <div className={styles['thinking-segment']}>
          <ThinkingBlock content={segment.text} isActiveThinking={isActiveThinking} />
        </div>
      );
    case 'tool': {
      const Component = getToolComponent(segment.tool.name, agentKind);
      return (
        <div className={styles['tool-segment']}>
          <Suspense
            fallback={
              <div className={styles['tool-fallback']}>
                <Spinner size="sm" className={styles['tool-fallback-spinner']} />
                <span className={styles['tool-fallback-text']}>Loading tool output...</span>
              </div>
            }
          >
            <Component tool={segment.tool} chatId={chatId} />
          </Suspense>
        </div>
      );
    }
    case 'suggestions':
      if (!isLastBotMessage || !onSuggestionSelect) return null;
      return <PromptSuggestions suggestions={segment.suggestions} onSelect={onSuggestionSelect} />;
    default:
      return null;
  }
});
