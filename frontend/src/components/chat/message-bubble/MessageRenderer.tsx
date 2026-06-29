import React, { memo } from 'react';
import { SegmentView } from './SegmentView';
import { WorkedRollup } from './WorkedRollup';
import { buildSegments } from './segmentBuilder';
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
}

const MessageRendererInner: React.FC<MessageRendererProps> = ({
  events,
  className = '',
  isStreaming = false,
  chatId,
  isLastBotMessage = false,
  durationMs = null,
  onSuggestionSelect,
  agentKind,
}) => {
  const { segments, activeThinkingIndex } = React.useMemo(() => {
    const builtSegments = buildSegments(events);

    let thinkingIndex = -1;
    if (isStreaming && events.length > 0) {
      const lastEvent = events[events.length - 1];
      if (lastEvent.type === 'assistant_thinking') {
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].type === 'assistant_thinking') {
            thinkingIndex = i;
            break;
          }
        }
      }
    }

    return {
      segments: builtSegments,
      activeThinkingIndex: thinkingIndex,
    };
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

  return (
    <AgentToolsContext value={agentTools}>
      <div className={className}>
        {traceSegments.length > 0 && (
          <WorkedRollup durationMs={durationMs}>
            {traceSegments.map((segment) => (
              <SegmentView
                key={segment.id}
                segment={segment}
                chatId={chatId}
                agentKind={agentKind}
                activeThinkingIndex={activeThinkingIndex}
                isLastBotMessage={isLastBotMessage}
                onSuggestionSelect={onSuggestionSelect}
              />
            ))}
          </WorkedRollup>
        )}
        {tailSegments.map((segment) => (
          <SegmentView
            key={segment.id}
            segment={segment}
            chatId={chatId}
            agentKind={agentKind}
            activeThinkingIndex={activeThinkingIndex}
            isLastBotMessage={isLastBotMessage}
            onSuggestionSelect={onSuggestionSelect}
          />
        ))}
      </div>
    </AgentToolsContext>
  );
};

export const MessageRenderer = memo(MessageRendererInner);
