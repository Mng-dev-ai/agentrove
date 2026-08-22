import type { ToolEventPayload } from './tools.types';
import type { PermissionMode } from '@/store/chatSettingsStore';

export interface MessageAttachment {
  id: string;
  message_id: string;
  file_url: string;
  file_type: 'image' | 'pdf' | 'xlsx';
  filename?: string;
  created_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  content_text: string;
  content_render: {
    events: AssistantStreamEvent[];
  };
  last_seq: number;
  active_stream_id: string | null;
  stream_status: 'in_progress' | 'completed' | 'failed' | 'interrupted' | null;
  is_bot?: boolean;
  role: 'user' | 'assistant';
  model_id: string | null;
  duration_ms: number | null;
  attachments: MessageAttachment[];
  created_at: string;
  checkpoint_id: string | null;
}

// Plan events replace the whole list (not append).
export interface PlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: string;
}

export type AssistantStreamEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'assistant_thinking'; thinking: string }
  | { type: 'tool_started'; tool: ToolEventPayload }
  | { type: 'tool_completed'; tool: ToolEventPayload }
  | { type: 'tool_failed'; tool: ToolEventPayload }
  | { type: 'user_text'; text: string }
  | { type: 'plan'; data?: { entries?: PlanEntry[] } }
  | {
      type: 'system';
      data?: { context_usage?: { tokens_used: number; context_window: number } } & Record<
        string,
        unknown
      >;
    }
  | {
      type: 'permission_request';
      request_id: string;
      tool_name: string;
      tool_input: Record<string, unknown>;
      options: PermissionOption[];
    }
  | {
      type: 'elicitation_request';
      request_id: string;
      data: {
        message: string;
        tool_call_id: string | null;
        requested_schema: ElicitationSchema;
      };
    }
  | { type: 'elicitation_dismissed'; request_id: string }
  | { type: 'prompt_suggestions'; suggestions: string[] };

export interface Chat {
  id: string;
  user_id: string;
  title: string;
  workspace_id: string;
  sandbox_id: string;
  created_at: string;
  updated_at: string;
  context_token_usage?: number;
  pinned_at: string | null;
  worktree_cwd: string | null;
  parent_chat_id: string | null;
  sub_thread_count: number;
  session_agent_kind: AgentKind | null;
  unread: boolean;
  last_model_id: string | null;
  last_thinking_mode: string | null;
  last_persona_name: string | null;
}

// /chat/chats/events SSE — useChatEvents (local) / useCloudChatEvents (VPS).
export type ChatEvent =
  | { kind: 'chat_created'; chat: Chat }
  | { kind: 'stream_started'; chat_id: string; message_id: string }
  | { kind: 'title_updated'; chat_id: string; title: string };

export interface ChatRequest {
  prompt: string;
  chat_id?: string;
  model_id: string;
  attached_files?: File[];
  permission_mode: PermissionMode;
  thinking_mode?: string;
  worktree?: boolean;
  // Base branch for the worktree; only sent when worktree creates one this turn.
  base_branch?: string;
  // Codex-only; ignored by other agents on the backend.
  fast_mode?: boolean;
  selected_persona_name: string;
}

export interface ChatSearchMatch {
  message_id: string;
  role: 'user' | 'assistant';
  snippet_before: string;
  snippet_match: string;
  snippet_after: string;
  created_at: string;
}

export interface ChatSearchResult {
  chat_id: string;
  chat_title: string;
  workspace_id: string;
  workspace_name: string;
  matches: ChatSearchMatch[];
  match_count: number;
}

export interface ChatSearchResponse {
  results: ChatSearchResult[];
  truncated: boolean;
}

export interface CreateChatRequest {
  title: string;
  model_id: string;
  workspace_id: string;
  parent_chat_id?: string;
}

export type AgentKind =
  | 'antigravity'
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'cursor'
  | 'grok'
  | 'opencode';

export interface Model {
  model_id: string;
  name: string;
  agent_kind: AgentKind;
  context_window: number | null;
}

const CODEX_MODEL_IDS = new Set([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
]);

export function getAgentKindForModelId(modelId: string | null | undefined): AgentKind {
  if (!modelId) {
    return 'claude';
  }
  if (CODEX_MODEL_IDS.has(modelId)) return 'codex';
  // Prefix convention for non-Codex providers (avoids a second static set).
  if (modelId.startsWith('antigravity:')) return 'antigravity';
  if (modelId.startsWith('copilot:')) return 'copilot';
  if (modelId.startsWith('cursor:')) return 'cursor';
  if (modelId.startsWith('grok:')) return 'grok';
  if (modelId.startsWith('opencode:')) return 'opencode';
  return 'claude';
}

export interface ContextUsage {
  tokens_used: number;
  context_window: number;
  percentage: number;
}

export interface PermissionOption {
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  name: string;
  option_id: string;
  permission_mode?: PermissionMode | null;
}

export interface PermissionRequest {
  request_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  options: PermissionOption[];
  // Envelope seq for dedupe on reconnect (request_id can be reused across turns).
  seq: number;
}

// Flat JSON-schema subset the agent may ask the user to fill in. Property values
// stay `unknown` — the parser (utils/elicitationSchema) narrows the shapes it knows
// and degrades the rest to a text field.
export interface ElicitationSchema {
  type?: string;
  properties?: Record<string, unknown>;
}

export interface ElicitationRequest {
  request_id: string;
  message: string;
  tool_call_id: string | null;
  requested_schema: ElicitationSchema;
}

export type ElicitationAction = 'accept' | 'decline' | 'cancel';

export type ElicitationContent = Record<string, string | string[] | number | boolean>;

// GET /chat/chats/{id}/status — active-turn snapshot used to recover after a refresh.
export interface ChatStatusResponse {
  has_active_task: boolean;
  message_id?: string;
  stream_id?: string;
  last_seq?: number;
  // Forms still awaiting an answer, oldest first. Server truth: event replay can
  // start past the control event when parallel tool activity advanced the snapshot.
  pending_elicitations?: ElicitationRequest[];
}
