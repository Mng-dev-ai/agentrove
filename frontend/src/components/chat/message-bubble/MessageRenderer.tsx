import React, { memo } from 'react';
import { SegmentView } from './SegmentView';
import { TraceLoadState, WorkedRollup } from './WorkedRollup';
import { useMessageRenderQuery } from '@/hooks/queries/useChatQueries';
import { buildSegments, segmentsEqual, type MessageSegment } from './segmentBuilder';
import { AgentToolsContext } from '@/contexts/AgentToolsContext';
import type { AgentKind, AssistantStreamEvent } from '@/types/chat.types';
import type { ToolAggregate } from '@/types/tools.types';

interface MessageRendererProps {
  events: AssistantStreamEvent[];
  // Set when `events` lack tool results; the full render is fetched before the
  // trace mounts.
  omittedToolResults?: { chatId: string; messageId: string };
  className?: string;
  isStreaming?: boolean;
  isCompleted?: boolean;
  chatId?: string;
  isLastBotMessage?: boolean;
  durationMs?: number | null;
  onSuggestionSelect?: (suggestion: string) => void;
  agentKind?: AgentKind;
  highlightMentions?: boolean;
}

const isTraceSegment = (segment: MessageSegment): boolean =>
  segment.kind === 'tool' || segment.kind === 'thinking' || segment.kind === 'plan';

const isRenderUiSegment = (segment: MessageSegment): boolean =>
  segment.kind === 'tool' && segment.tool.name === 'mcp__agentrove__render_ui';

const movesToTrace = (segment: MessageSegment): boolean =>
  isTraceSegment(segment) && !isRenderUiSegment(segment);

export const MessageRenderer = memo(function MessageRenderer({
  events: initialEvents,
  omittedToolResults,
  className = '',
  isStreaming = false,
  isCompleted = false,
  chatId,
  isLastBotMessage = false,
  durationMs = null,
  onSuggestionSelect,
  agentKind,
  highlightMentions = false,
}: MessageRendererProps) {
  const prevSegmentsRef = React.useRef<Map<string, MessageSegment>>(new Map());
  const [fullRenderRequested, setFullRenderRequested] = React.useState(false);
  const hasSteering = initialEvents.some((event) => event.type === 'user_steering');
  const fullRender = useMessageRenderQuery(
    omittedToolResults?.chatId ?? '',
    omittedToolResults?.messageId ?? '',
    omittedToolResults !== undefined && (fullRenderRequested || hasSteering),
  );
  const events = fullRender.data?.events ?? initialEvents;
  const awaitingFullRender = omittedToolResults !== undefined && !fullRender.data;
  const requestFullRender = React.useCallback(() => setFullRenderRequested(true), []);

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
        // Claude `Agent` / opencode `subagent` (`task` before v2) — expand-modal sibling list.
        if (
          seg.kind === 'tool' &&
          (seg.tool.name === 'Agent' || seg.tool.name === 'subagent' || seg.tool.name === 'task')
        ) {
          acc.push(seg.tool);
        }
        return acc;
      }, []),
    [segments],
  );

  // Finished turns: collapsible work trace ends at last tool/thinking/plan, except that a
  // completed turn's final text always stays in the tail; streaming stays flat.
  const { traceSegments, tailSegments } = React.useMemo(() => {
    if (isStreaming || hasSteering) return { traceSegments: [], tailSegments: segments };
    let traceEnd = -1;
    let lastText = -1;
    segments.forEach((segment, i) => {
      if (isTraceSegment(segment)) traceEnd = i;
      if (segment.kind === 'text') lastText = i;
    });
    if (traceEnd < 0) return { traceSegments: [], tailSegments: segments };
    const tailStart =
      isCompleted && lastText >= 0 ? Math.min(lastText, traceEnd + 1) : traceEnd + 1;
    const rest = segments.slice(tailStart);
    return {
      traceSegments: [...segments.slice(0, tailStart), ...rest.filter(movesToTrace)],
      tailSegments: rest.filter((segment) => !movesToTrace(segment)),
    };
  }, [segments, isStreaming, isCompleted, hasSteering]);
  // If a turn is cut off before an answer, the trace is the only visible content —
  // unless its tool results were omitted, where showing it would mean fetching
  // the full render on chat open.
  const rollUpTrace =
    traceSegments.length > 0 && (tailSegments.length > 0 || omittedToolResults !== undefined);
  const { rollupSegments, renderUiSegments } = React.useMemo(() => {
    if (!rollUpTrace) return { rollupSegments: traceSegments, renderUiSegments: [] };
    const rollupSegments: MessageSegment[] = [];
    const renderUiSegments: MessageSegment[] = [];
    for (const segment of traceSegments) {
      if (isRenderUiSegment(segment)) {
        renderUiSegments.push(segment);
      } else {
        rollupSegments.push(segment);
      }
    }
    return { rollupSegments, renderUiSegments };
  }, [traceSegments, rollUpTrace]);
  const segmentViewProps = {
    chatId,
    agentKind,
    isLastBotMessage,
    onSuggestionSelect,
    highlightMentions,
  };
  // Per-segment booleans instead of the active ids: when the active segment
  // changes, only the segments whose flag flipped lose their memo bailout.
  const traceNodes = awaitingFullRender ? (
    <TraceLoadState failed={fullRender.isError} onRetry={() => void fullRender.refetch()} />
  ) : (
    rollupSegments.map((segment) => (
      <SegmentView
        key={segment.id}
        segment={segment}
        isActiveThinking={segment.id === activeThinkingId}
        isActiveText={segment.id === activeTextId}
        {...segmentViewProps}
      />
    ))
  );
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
        {hasSteering && awaitingFullRender && (
          <TraceLoadState failed={fullRender.isError} onRetry={() => void fullRender.refetch()} />
        )}
        {rollUpTrace
          ? rollupSegments.length > 0 && (
              <WorkedRollup durationMs={durationMs} onExpand={requestFullRender}>
                {traceNodes}
              </WorkedRollup>
            )
          : traceNodes}
        {renderUiSegments.map((segment) => (
          <SegmentView
            key={segment.id}
            segment={segment}
            isActiveThinking={segment.id === activeThinkingId}
            isActiveText={segment.id === activeTextId}
            {...segmentViewProps}
          />
        ))}
        {tailNodes}
      </div>
    </AgentToolsContext>
  );
});
