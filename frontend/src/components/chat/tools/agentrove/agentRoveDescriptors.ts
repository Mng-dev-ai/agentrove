import { extractResultText } from '@/utils/agentTool';
import { formatResult } from '@/utils/format';

const PREFIX = 'mcp__agentrove__';

type ToolInput = Record<string, unknown>;

interface AgentRoveDescriptor {
  label: string;
  summary?: (input: ToolInput) => string | null;
  longFields?: string[];
}

export interface ParsedAgentRoveResult {
  data: ToolInput | null;
  text: string;
}

const isRecord = (value: unknown): value is ToolInput =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const value = (input: ToolInput, key: string): string | null => {
  const raw = input[key];
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number') return String(raw);
  return null;
};

const labeled = (input: ToolInput, key: string, label: string): string | null => {
  const resolved = value(input, key);
  return resolved ? `${label} ${resolved}` : null;
};

const flag = (input: ToolInput, key: string): string | null => (input[key] === true ? key : null);

const join = (...parts: (string | null)[]): string | null =>
  parts.filter(Boolean).join(' · ') || null;

const DESCRIPTORS: Record<string, AgentRoveDescriptor> = {
  list_workspaces: { label: 'List Workspaces' },
  list_models: { label: 'List Models', summary: (i) => value(i, 'agent_kind') },
  get_current_chat: { label: 'Get Current Chat' },
  list_chats: { label: 'List Chats', summary: (i) => labeled(i, 'workspace_id', 'workspace') },
  list_personas: { label: 'List Personas' },
  get_persona: { label: 'Get Persona', summary: (i) => value(i, 'name') },
  create_persona: {
    label: 'Create Persona',
    summary: (i) => value(i, 'name'),
    longFields: ['content'],
  },
  update_persona: {
    label: 'Update Persona',
    summary: (i) => value(i, 'name'),
    longFields: ['content'],
  },
  delete_persona: { label: 'Delete Persona', summary: (i) => value(i, 'name') },
  send_message: {
    label: 'Send Message',
    summary: (i) =>
      join(
        value(i, 'model_id'),
        labeled(i, 'persona', 'persona'),
        labeled(i, 'thinking_mode', 'thinking'),
        flag(i, 'worktree'),
        flag(i, 'fast_mode'),
      ),
    longFields: ['prompt'],
  },
  get_messages: { label: 'Get Messages', summary: (i) => labeled(i, 'chat_id', 'chat') },
  list_automations: { label: 'List Automations' },
  create_automation: {
    label: 'Create Automation',
    summary: (i) => join(value(i, 'name'), value(i, 'cron_expression')),
    longFields: ['prompt'],
  },
  update_automation: {
    label: 'Update Automation',
    summary: (i) =>
      join(
        value(i, 'name') ?? labeled(i, 'automation_id', 'automation'),
        value(i, 'cron_expression'),
      ),
    longFields: ['prompt'],
  },
  delete_automation: {
    label: 'Delete Automation',
    summary: (i) => labeled(i, 'automation_id', 'automation'),
  },
  run_automation: {
    label: 'Run Automation',
    summary: (i) => labeled(i, 'automation_id', 'automation'),
  },
};

export const stripAgentRovePrefix = (toolName: string): string =>
  toolName.startsWith(PREFIX) ? toolName.slice(PREFIX.length) : toolName;

export const humanizeToolName = (name: string): string =>
  name
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const getDescriptor = (toolName: string): AgentRoveDescriptor => {
  const name = stripAgentRovePrefix(toolName);
  return DESCRIPTORS[name] ?? { label: humanizeToolName(name) || name };
};

export const buildInputSummary = (
  toolName: string,
  input: ToolInput | null | undefined,
): string | null => {
  const { summary } = getDescriptor(toolName);
  if (!summary || !input) return null;
  return summary(input);
};

export const collectLongInputFields = (
  toolName: string,
  input: ToolInput | null | undefined,
): { key: string; text: string }[] => {
  const { longFields } = getDescriptor(toolName);
  if (!longFields || !input) return [];
  return longFields.flatMap((key) => {
    // Trim only to detect blanks — keep the raw string, whitespace matters in prompts.
    const raw = input[key];
    if (typeof raw !== 'string' || !raw.trim()) return [];
    return [{ key, text: raw }];
  });
};

// Results arrive as [{type:'text', text}] blocks holding JSON, a plain object,
// or a bare string — never throw, always keep the text for the raw fallback.
export const parseAgentRoveResult = (result: unknown): ParsedAgentRoveResult => {
  if (result === null || result === undefined) return { data: null, text: '' };
  if (isRecord(result)) return { data: result, text: formatResult(result) };
  const text = extractResultText(result) ?? formatResult(result);
  try {
    const parsed: unknown = JSON.parse(text);
    return { data: isRecord(parsed) ? parsed : null, text };
  } catch {
    return { data: null, text };
  }
};

export const summarizeResultData = (data: ToolInput | null): string | null => {
  if (!data) return null;
  if (data.deleted === true) return 'deleted ✓';
  return (
    Object.entries(data)
      .filter(([, entry]) => Array.isArray(entry))
      .map(([key, entry]) => `${(entry as unknown[]).length} ${key}`)
      .join(' · ') || null
  );
};

export const extractChatId = (data: ToolInput | null): string | null =>
  data && typeof data.chat_id === 'string' && data.chat_id ? data.chat_id : null;
