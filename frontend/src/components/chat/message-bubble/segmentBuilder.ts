import type { AssistantStreamEvent, PlanEntry } from '@/types/chat.types';
import type { ToolAggregate, ToolEventStatus } from '@/types/tools.types';
import { PROMPT_SUGGESTIONS_RE } from '@/utils/stream';

const PARTIAL_PROMPT_SUGGESTIONS_RE = /<prompt_suggestions>[\s\S]*$/;

export interface TextSegment {
  kind: 'text';
  id: string;
  text: string;
}

export interface ThinkingSegment {
  kind: 'thinking';
  id: string;
  text: string;
}

export interface ToolSegment {
  kind: 'tool';
  id: string;
  tool: ToolAggregate;
}

export interface SuggestionsSegment {
  kind: 'suggestions';
  id: string;
  suggestions: string[];
}

export interface PlanSegment {
  kind: 'plan';
  id: string;
  entries: PlanEntry[];
}

export type MessageSegment =
  | TextSegment
  | ThinkingSegment
  | ToolSegment
  | SuggestionsSegment
  | PlanSegment;

const toolsEqual = (a: ToolAggregate, b: ToolAggregate): boolean => {
  // Aggregates are rebuilt from scratch on every stream flush, but input/result/
  // error come straight off the underlying event payloads, which keep object
  // identity across rebuilds — reference checks detect real changes.
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.title !== b.title ||
    a.status !== b.status ||
    a.parentId !== b.parentId ||
    a.input !== b.input ||
    a.result !== b.result ||
    a.error !== b.error ||
    a.children.length !== b.children.length
  ) {
    return false;
  }
  return a.children.every((child, i) => toolsEqual(child, b.children[i]));
};

export const segmentsEqual = (a: MessageSegment, b: MessageSegment): boolean => {
  // Lets MessageRenderer hand unchanged segments the same object identity across
  // flushes so memoized SegmentViews bail out instead of re-rendering.
  if (a.id !== b.id) return false;
  if (a.kind === 'text' && b.kind === 'text') return a.text === b.text;
  if (a.kind === 'thinking' && b.kind === 'thinking') return a.text === b.text;
  if (a.kind === 'tool' && b.kind === 'tool') return toolsEqual(a.tool, b.tool);
  if (a.kind === 'suggestions' && b.kind === 'suggestions') return a.suggestions === b.suggestions;
  if (a.kind === 'plan' && b.kind === 'plan') return a.entries === b.entries;
  return false;
};

const statusMap: Record<'tool_started' | 'tool_completed' | 'tool_failed', ToolEventStatus> = {
  tool_started: 'started',
  tool_completed: 'completed',
  tool_failed: 'failed',
};

// pendingChildren holds tools whose parent_id arrived before the parent tool event.
interface ProcessToolEventContext {
  toolMap: Map<string, ToolAggregate>;
  pendingChildren: Map<string, ToolAggregate[]>;
  segmentIndexByToolId: Map<string, number>;
  segments: MessageSegment[];
}

const updateSegmentTool = (
  toolId: string,
  updatedTool: ToolAggregate,
  segments: MessageSegment[],
  segmentIndexByToolId: Map<string, number>,
): void => {
  const segmentIndex = segmentIndexByToolId.get(toolId);
  if (segmentIndex !== undefined && segments[segmentIndex].kind === 'tool') {
    segments[segmentIndex] = {
      ...segments[segmentIndex],
      tool: updatedTool,
    } as ToolSegment;
  }
};

const updateParentChain = (
  childAggregate: ToolAggregate,
  toolMap: Map<string, ToolAggregate>,
  segments: MessageSegment[],
  segmentIndexByToolId: Map<string, number>,
): void => {
  if (!childAggregate.parentId) return;

  const parent = toolMap.get(childAggregate.parentId);
  if (!parent) return;

  const updatedParent = {
    ...parent,
    children: parent.children.map((child) =>
      child.id === childAggregate.id ? childAggregate : child,
    ),
  };

  toolMap.set(childAggregate.parentId, updatedParent);
  updateSegmentTool(childAggregate.parentId, updatedParent, segments, segmentIndexByToolId);
  updateParentChain(updatedParent, toolMap, segments, segmentIndexByToolId);
};

const createToolAggregate = (
  payload: Extract<
    AssistantStreamEvent,
    { type: 'tool_started' | 'tool_completed' | 'tool_failed' }
  >['tool'],
  status: ToolEventStatus,
  parentId: string | null,
): ToolAggregate => ({
  id: payload.id,
  name: payload.name,
  title: payload.title,
  status,
  parentId,
  input: (payload.input || null) as Record<string, unknown> | null,
  result: payload.result,
  error: payload.error,
  children: [],
});

const attachPendingChildren = (
  aggregate: ToolAggregate,
  pendingChildren: Map<string, ToolAggregate[]>,
): ToolAggregate => {
  const waitingChildren = pendingChildren.get(aggregate.id);
  if (!waitingChildren || waitingChildren.length === 0) return aggregate;

  const updated = {
    ...aggregate,
    children: [...aggregate.children, ...waitingChildren],
  };
  pendingChildren.delete(aggregate.id);
  return updated;
};

const addChildToParent = (
  child: ToolAggregate,
  parentId: string,
  context: ProcessToolEventContext,
): void => {
  const { toolMap, pendingChildren, segments, segmentIndexByToolId } = context;
  const parent = toolMap.get(parentId);

  if (parent) {
    const alreadyAttached = parent.children.some((existing) => existing.id === child.id);
    if (!alreadyAttached) {
      const updatedParent = {
        ...parent,
        children: [...parent.children, child],
      };
      toolMap.set(parentId, updatedParent);
      updateSegmentTool(parentId, updatedParent, segments, segmentIndexByToolId);

      if (updatedParent.parentId) {
        updateParentChain(updatedParent, toolMap, segments, segmentIndexByToolId);
      }
    }
  } else {
    const queue = pendingChildren.get(parentId) ?? [];
    queue.push(child);
    pendingChildren.set(parentId, queue);
  }
};

const removeFromPreviousParent = (
  toolId: string,
  previousParentId: string,
  context: ProcessToolEventContext,
): void => {
  const { toolMap, segments, segmentIndexByToolId } = context;
  const previousParent = toolMap.get(previousParentId);

  if (previousParent) {
    const updatedParent = {
      ...previousParent,
      children: previousParent.children.filter((child) => child.id !== toolId),
    };
    toolMap.set(previousParentId, updatedParent);
    updateSegmentTool(previousParentId, updatedParent, segments, segmentIndexByToolId);

    if (updatedParent.parentId) {
      updateParentChain(updatedParent, toolMap, segments, segmentIndexByToolId);
    }
  }
};

// Drop from root segments when reparented; reindex so later O(1) updates stay correct.
const removeToolFromRootSegments = (
  toolId: string,
  segmentIndexByToolId: Map<string, number>,
  segments: MessageSegment[],
): void => {
  const rootIndex = segmentIndexByToolId.get(toolId);
  if (rootIndex === undefined) return;

  segments.splice(rootIndex, 1);
  segmentIndexByToolId.delete(toolId);

  segmentIndexByToolId.forEach((idx, id) => {
    if (idx > rootIndex) {
      segmentIndexByToolId.set(id, idx - 1);
    }
  });
};

// Backend can correct parent_id mid-stream — re-home under the new parent or promote to root.
const handleParentChange = (
  aggregate: ToolAggregate,
  incomingParentId: string | null,
  previousParentId: string | null,
  context: ProcessToolEventContext,
): void => {
  if (previousParentId && previousParentId !== incomingParentId) {
    removeFromPreviousParent(aggregate.id, previousParentId, context);
  }

  if (incomingParentId) {
    removeToolFromRootSegments(aggregate.id, context.segmentIndexByToolId, context.segments);
    addChildToParent(aggregate, incomingParentId, context);
  } else if (!context.segmentIndexByToolId.has(aggregate.id)) {
    context.segments.push({ kind: 'tool', id: `tool-${aggregate.id}`, tool: aggregate });
    context.segmentIndexByToolId.set(aggregate.id, context.segments.length - 1);
  }
};

const processNewTool = (
  payload: Extract<
    AssistantStreamEvent,
    { type: 'tool_started' | 'tool_completed' | 'tool_failed' }
  >['tool'],
  toolStatus: ToolEventStatus,
  parentId: string | null,
  context: ProcessToolEventContext,
): void => {
  const { toolMap, segments, segmentIndexByToolId } = context;

  let newAggregate = createToolAggregate(payload, toolStatus, parentId);
  newAggregate = attachPendingChildren(newAggregate, context.pendingChildren);
  toolMap.set(payload.id, newAggregate);

  if (parentId) {
    addChildToParent(newAggregate, parentId, context);
  } else {
    segments.push({ kind: 'tool', id: `tool-${newAggregate.id}`, tool: newAggregate });
    segmentIndexByToolId.set(newAggregate.id, segments.length - 1);
  }
};

const processExistingTool = (
  payload: Extract<
    AssistantStreamEvent,
    { type: 'tool_started' | 'tool_completed' | 'tool_failed' }
  >['tool'],
  existingAggregate: ToolAggregate,
  toolStatus: ToolEventStatus,
  context: ProcessToolEventContext,
): void => {
  const { toolMap, segments, segmentIndexByToolId } = context;

  const updatedAggregate: ToolAggregate = {
    ...existingAggregate,
    name: payload.name || existingAggregate.name,
    title: payload.title || existingAggregate.title,
    status: toolStatus,
    input: payload.input ? (payload.input as Record<string, unknown>) : existingAggregate.input,
    result: payload.result !== undefined ? payload.result : existingAggregate.result,
    error: payload.error || existingAggregate.error,
  };

  if (payload.parent_id !== undefined) {
    const incomingParentId = payload.parent_id ?? null;
    if (existingAggregate.parentId !== incomingParentId) {
      updatedAggregate.parentId = incomingParentId;
      handleParentChange(
        updatedAggregate,
        incomingParentId,
        existingAggregate.parentId ?? null,
        context,
      );
    }
  }

  toolMap.set(payload.id, updatedAggregate);
  updateSegmentTool(payload.id, updatedAggregate, segments, segmentIndexByToolId);

  if (updatedAggregate.parentId) {
    updateParentChain(updatedAggregate, toolMap, segments, segmentIndexByToolId);
  }
};

const processToolEvent = (
  event: Extract<AssistantStreamEvent, { type: 'tool_started' | 'tool_completed' | 'tool_failed' }>,
  context: ProcessToolEventContext,
): void => {
  const { toolMap } = context;
  const payload = event.tool;
  const toolStatus = statusMap[event.type];
  const parentId = payload.parent_id ?? null;
  const existingAggregate = toolMap.get(payload.id);

  if (!existingAggregate) {
    processNewTool(payload, toolStatus, parentId, context);
  } else {
    processExistingTool(payload, existingAggregate, toolStatus, context);
  }
};

// Flat stream events → text/thinking/tool/plan/suggestions segments (incl. out-of-order tool parents).
export const buildSegments = (events: AssistantStreamEvent[]): MessageSegment[] => {
  const segments: MessageSegment[] = [];
  const toolMap = new Map<string, ToolAggregate>();
  const segmentIndexByToolId = new Map<string, number>();
  const pendingChildren = new Map<string, ToolAggregate[]>();
  let pendingText = '';
  let pendingThinking = '';
  let textSegmentCount = 0;
  let thinkingSegmentCount = 0;
  let suggestionsSegmentCount = 0;
  let planSegmentCount = 0;

  const flushText = () => {
    if (!pendingText) return;
    // Strip prompt_suggestions tags that arrive as raw text via partial streaming
    const hasTag = pendingText.includes('<prompt_suggestion');
    const cleaned = hasTag
      ? pendingText
          .replace(PROMPT_SUGGESTIONS_RE, '')
          .replace(PARTIAL_PROMPT_SUGGESTIONS_RE, '')
          .trimEnd()
      : pendingText;
    if (cleaned) {
      segments.push({
        kind: 'text',
        id: `text-${textSegmentCount}`,
        text: cleaned,
      });
      textSegmentCount++;
    }
    pendingText = '';
  };

  const flushThinking = () => {
    if (!pendingThinking) return;
    segments.push({
      kind: 'thinking',
      id: `thinking-${thinkingSegmentCount}`,
      text: pendingThinking,
    });
    thinkingSegmentCount++;
    pendingThinking = '';
  };

  const context: ProcessToolEventContext = {
    toolMap,
    pendingChildren,
    segmentIndexByToolId,
    segments,
  };

  events.forEach((event) => {
    switch (event.type) {
      case 'assistant_text':
        flushThinking();
        pendingText += event.text;
        break;
      case 'assistant_thinking':
        flushText();
        pendingThinking += event.thinking;
        break;
      case 'prompt_suggestions':
        flushText();
        flushThinking();
        segments.push({
          kind: 'suggestions',
          id: `suggestions-${suggestionsSegmentCount}`,
          suggestions: event.suggestions,
        });
        suggestionsSegmentCount++;
        break;
      case 'tool_started':
      case 'tool_completed':
      case 'tool_failed':
        flushText();
        flushThinking();
        processToolEvent(event, context);
        break;
      case 'plan': {
        const entries = event.data?.entries;
        if (!Array.isArray(entries) || entries.length === 0) break;
        // Each plan event is a full snapshot. Render it at the current stream
        // position so updates stay visible as the chat scrolls; collapse
        // back-to-back snapshots into one card instead of stacking duplicates.
        const last = segments[segments.length - 1];
        if (last?.kind === 'plan' && !pendingText && !pendingThinking) {
          segments[segments.length - 1] = { kind: 'plan', id: last.id, entries };
        } else {
          flushText();
          flushThinking();
          segments.push({ kind: 'plan', id: `plan-${planSegmentCount}`, entries });
          planSegmentCount++;
        }
        break;
      }
      case 'user_text':
        flushThinking();
        pendingText += event.text;
        break;
      default:
        break;
    }
  });

  flushText();
  flushThinking();
  return segments;
};
