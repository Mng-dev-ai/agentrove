import type { AgentKind } from '@/types/chat.types';

export interface ThinkingModeOption {
  value: string;
  label: string;
}

const CLAUDE_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];
const CLAUDE_OPUS_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];

const CODEX_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

// Cursor bakes reasoning effort into the model ID; OpenCode delegates to the
// per-model provider. Neither exposes a uniform thinking-mode dial via ACP,
// so an empty list hides the selector.
const EMPTY_THINKING_MODES: ThinkingModeOption[] = [];

export const THINKING_MODES_BY_AGENT: Record<AgentKind, ThinkingModeOption[]> = {
  claude: CLAUDE_THINKING_MODES,
  codex: CODEX_THINKING_MODES,
  copilot: CODEX_THINKING_MODES,
  cursor: EMPTY_THINKING_MODES,
  opencode: EMPTY_THINKING_MODES,
};

const DEFAULT_BY_AGENT: Record<AgentKind, string> = {
  claude: 'medium',
  codex: 'medium',
  copilot: 'medium',
  cursor: 'medium',
  opencode: 'medium',
};

export function getThinkingModesForAgent(
  agentKind: AgentKind,
  modelId?: string,
): ThinkingModeOption[] {
  // Claude exposes `xhigh` only for the Opus alias we map to Opus 4.7.
  if (agentKind === 'claude' && modelId === 'opus[1m]') {
    return CLAUDE_OPUS_THINKING_MODES;
  }

  return THINKING_MODES_BY_AGENT[agentKind];
}

export function coerceThinkingModeForAgent(
  thinkingMode: string,
  agentKind: AgentKind,
  modelId?: string,
): string {
  const modes = getThinkingModesForAgent(agentKind, modelId);
  const defaultMode = DEFAULT_BY_AGENT[agentKind];
  return modes.find((mode) => mode.value === thinkingMode)?.value ?? defaultMode;
}

export function getThinkingModeOption(
  thinkingMode: string,
  agentKind: AgentKind,
  modelId?: string,
): ThinkingModeOption | null {
  const modes = getThinkingModesForAgent(agentKind, modelId);
  if (modes.length === 0) return null;
  const effectiveMode = coerceThinkingModeForAgent(thinkingMode, agentKind, modelId);
  const selectedMode = modes.find((mode) => mode.value === effectiveMode);

  if (!selectedMode) {
    throw new Error(`Missing thinking mode option for ${agentKind}: ${effectiveMode}`);
  }

  return selectedMode;
}
