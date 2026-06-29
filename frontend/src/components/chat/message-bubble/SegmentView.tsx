import React, { Suspense } from 'react';
import { LazyMarkDown } from '@/components/ui/LazyMarkDown';
import { ThinkingBlock } from './ThinkingBlock';
import { PromptSuggestions } from './PromptSuggestions';
import { getToolComponent } from '@/components/chat/tools/registry';
import type { MessageSegment } from './segmentBuilder';
import type { AgentKind } from '@/types/chat.types';
import { Spinner } from '@/components/ui/primitives/Spinner';

interface SegmentViewProps {
  segment: MessageSegment;
  chatId?: string;
  agentKind?: AgentKind;
  activeThinkingIndex: number;
  isLastBotMessage: boolean;
  onSuggestionSelect?: (suggestion: string) => void;
}

export const SegmentView: React.FC<SegmentViewProps> = ({
  segment,
  chatId,
  agentKind,
  activeThinkingIndex,
  isLastBotMessage,
  onSuggestionSelect,
}) => {
  switch (segment.kind) {
    case 'text':
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none break-words">
          <LazyMarkDown content={segment.text} />
        </div>
      );
    case 'thinking':
      return (
        <div className="mb-2 mt-0.5">
          <ThinkingBlock
            content={segment.text}
            isActiveThinking={segment.eventIndex === activeThinkingIndex}
          />
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
};
