import { memo, Suspense } from 'react';
import { LazyMarkDown } from '@/components/ui/LazyMarkDown';
import { useSmoothText } from '@/hooks/useSmoothText';
import { ThinkingBlock } from './ThinkingBlock';
import { PromptSuggestions } from './PromptSuggestions';
import { getToolComponent } from '@/components/chat/tools/registry';
import type { MessageSegment } from './segmentBuilder';
import type { AgentKind } from '@/types/chat.types';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';

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
    <div className="prose prose-sm dark:prose-invert max-w-none break-words">
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
        <div className="mb-2 mt-0.5">
          <ThinkingBlock content={segment.text} isActiveThinking={isActiveThinking} />
        </div>
      );
    case 'tool': {
      const Component = getToolComponent(segment.tool.name, agentKind);
      return (
        <div className="mb-2 mt-1">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 dark:border-border-dark/50">
                <Spinner
                  size="sm"
                  className="text-text-quaternary dark:text-text-dark-quaternary"
                />
                <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                  Loading tool output...
                </span>
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
