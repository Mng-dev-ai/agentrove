import { memo, Suspense } from 'react';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import { useSmoothText } from '@/hooks/useSmoothText';
import { ThinkingBlock } from './ThinkingBlock';
import { PromptSuggestions } from './PromptSuggestions';
import { PlanCard } from './PlanCard';
import { NoticeCard } from './NoticeCard';
import { MessageAttachments } from './MessageAttachments';
import { UserBubble } from './Message';
import { getToolComponent } from '@/components/chat/tools/registry';
import type { MessageSegment } from './segmentBuilder';
import type { AgentKind } from '@/types/chat.types';
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

function TextSegment({
  text,
  isActive,
  highlightMentions,
}: {
  text: string;
  isActive: boolean;
  highlightMentions?: boolean;
}) {
  // The segment receiving stream output reveals its text word-by-word instead
  // of jumping a flush-sized chunk at a time.
  const [smoothText] = useSmoothText(text, isActive);
  return (
    <div className={styles['text-segment']}>
      <MarkDown
        content={smoothText}
        streaming={isActive}
        mentions={highlightMentions ? 'all' : undefined}
        // Mention pills mark user text; only replies take the looser prose leading
        prose={!highlightMentions}
      />
    </div>
  );
}

export function ToolPlaceholder() {
  return <div className={styles['tool-placeholder']} />;
}

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
    case 'steering':
      return (
        <div className={styles['steering-segment']}>
          {segment.appNotice ? (
            <NoticeCard text={segment.text} />
          ) : (
            <UserBubble>
              <MessageAttachments attachments={segment.attachments} chatId={chatId} />
              <MarkDown content={segment.text} mentions="all" />
            </UserBubble>
          )}
        </div>
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
          <Suspense fallback={<ToolPlaceholder />}>
            <Component tool={segment.tool} chatId={chatId} />
          </Suspense>
        </div>
      );
    }
    case 'suggestions':
      if (!isLastBotMessage || !onSuggestionSelect) return null;
      return <PromptSuggestions suggestions={segment.suggestions} onSelect={onSuggestionSelect} />;
    case 'plan':
      return (
        <div className={styles['tool-segment']}>
          <PlanCard entries={segment.entries} />
        </div>
      );
    default:
      return null;
  }
});
