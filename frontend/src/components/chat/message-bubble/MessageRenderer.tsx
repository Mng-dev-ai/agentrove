import React, { memo } from 'react';
import { SegmentView } from './SegmentView';
import { WorkedRollup } from './WorkedRollup';
import { buildSegments, segmentsEqual, type MessageSegment } from './segmentBuilder';
import { AgentToolsContext } from '@/contexts/AgentToolsContext';
import type { AgentKind, AssistantStreamEvent } from '@/types/chat.types';
import type { ToolAggregate } from '@/types/tools.types';

interface MessageRendererProps {
  events: AssistantStreamEvent[];
  className?: string;
  isStreaming?: boolean;
  chatId?: string;
  isLastBotMessage?: boolean;
  durationMs?: number | null;
  onSuggestionSelect?: (suggestion: string) => void;
  agentKind?: AgentKind;
  highlightMentions?: boolean;
}

export const MessageRenderer = memo(function MessageRenderer({
  events,
  className = '',
  isStreaming = false,
  chatId,
  isLastBotMessage = false,
  durationMs = null,
  onSuggestionSelect,
  agentKind,
  highlightMentions = false,
}: MessageRendererProps) {
  const prevSegmentsRef = React.useRef<Map<string, MessageSegment>>(new Map());

  const { segments, activeThinkingId, activeTextId } = React.useMemo(() => {
    const builtSegments = buildSegments(events);

    // Reuse the previous object for any segment whose content didn't change so
    // memoized SegmentViews bail out — otherwise every stream flush re-renders
    // every completed tool/thinking/text segment, not just the growing tail.
    const previousById = prevSegmentsRef.current;
    const stableSegments = builtSegments.map((segment) => {
      const previous = previousById.get(segment.id);
      return previous && segmentsEqual(previous, segment) ? previous : segment;
    });
    prevSegmentsRef.current = new Map(stableSegments.map((segment) => [segment.id, segment]));

    // The live thinking indicator and the word-reveal animation apply only to
    // the segment currently receiving stream output — always the last segment,
    // gated on the last event's type so a late tool update on an earlier
    // segment doesn't masquerade as active thinking/typing.
    const lastEvent = events[events.length - 1];
    const lastSegment = stableSegments[stableSegments.length - 1];
    const thinkingId =
      isStreaming && lastEvent?.type === 'assistant_thinking' && lastSegment?.kind === 'thinking'
        ? lastSegment.id
        : null;
    const textId =
      isStreaming && lastEvent?.type === 'assistant_text' && lastSegment?.kind === 'text'
        ? lastSegment.id
        : null;

    return { segments: stableSegments, activeThinkingId: thinkingId, activeTextId: textId };
  }, [events, isStreaming]);

  const agentTools = React.useMemo(
    () =>
      segments.reduce<ToolAggregate[]>((acc, seg) => {
        // Collect subagent-spawning tools across agents so the expand-modal
        // sibling list works for all of them: Claude's `Agent`, opencode's
        // `task`. Codex/Copilot/Cursor don't surface subagent spawns as
        // named tool calls.
        if (seg.kind === 'tool' && (seg.tool.name === 'Agent' || seg.tool.name === 'task')) {
          acc.push(seg.tool);
        }
        return acc;
      }, []),
    [segments],
  );

  // Split a completed turn at its last tool/thinking segment: everything up to
  // it is the collapsible work trace, everything after is the final answer.
  // While streaming, the trace stays empty so the live work renders flat.
  const { traceSegments, tailSegments } = React.useMemo(() => {
    if (isStreaming) return { traceSegments: [], tailSegments: segments };
    let traceEnd = -1;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].kind === 'tool' || segments[i].kind === 'thinking') {
        traceEnd = i;
        break;
      }
    }
    if (traceEnd < 0) return { traceSegments: [], tailSegments: segments };
    return {
      traceSegments: segments.slice(0, traceEnd + 1),
      tailSegments: segments.slice(traceEnd + 1),
    };
  }, [segments, isStreaming]);
  // If a turn is cut off before an answer, the trace is the only visible content.
  const rollUpTrace = traceSegments.length > 0 && tailSegments.length > 0;
  const segmentViewProps = {
    chatId,
    agentKind,
    isLastBotMessage,
    onSuggestionSelect,
    highlightMentions,
  };
  // Per-segment booleans instead of the active ids: when the active segment
  // changes, only the segments whose flag flipped lose their memo bailout.
  const traceNodes = traceSegments.map((segment) => (
    <SegmentView
      key={segment.id}
      segment={segment}
      isActiveThinking={segment.id === activeThinkingId}
      isActiveText={segment.id === activeTextId}
      {...segmentViewProps}
    />
  ));
  const tailNodes = tailSegments.map((segment) => (
    <SegmentView
      key={segment.id}
      segment={segment}
      isActiveThinking={segment.id === activeThinkingId}
      isActiveText={segment.id === activeTextId}
      {...segmentViewProps}
    />
  ));

  return (
    <AgentToolsContext value={agentTools}>
      <div className={className}>
        {rollUpTrace ? (
          <WorkedRollup durationMs={durationMs}>{traceNodes}</WorkedRollup>
        ) : (
          traceNodes
        )}
        {tailNodes}
      </div>
    </AgentToolsContext>
  );
});
