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

export type AssistantStreamEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'assistant_thinking'; thinking: string }
  | { type: 'tool_started'; tool: ToolEventPayload }
  | { type: 'tool_completed'; tool: ToolEventPayload }
  | { type: 'tool_failed'; tool: ToolEventPayload }
  | { type: 'user_text'; text: string }
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
}

export interface ChatRequest {
  prompt: string;
  chat_id?: string;
  model_id: string;
  attached_files?: File[];
  permission_mode: PermissionMode;
  thinking_mode?: string;
  worktree?: boolean;
  plan_mode?: boolean;
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

export type AgentKind = 'claude' | 'codex' | 'copilot' | 'cursor' | 'opencode';

export interface Model {
  model_id: string;
  name: string;
  agent_kind: AgentKind;
  context_window: number | null;
}

const CODEX_MODEL_IDS = new Set([
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
  // Copilot, Cursor, and OpenCode models use a prefix convention — detect by
  // convention instead of maintaining a duplicate static set.
  if (modelId.startsWith('copilot:')) return 'copilot';
  if (modelId.startsWith('cursor:')) return 'cursor';
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
  // Monotonic stream sequence of the originating envelope. Used to dedupe
  // replayed permission events (the backend persists and re-streams them after
  // `after_seq` on reconnect/refresh) without relying on request_id, which some
  // providers reuse across turns.
  seq: number;
}
