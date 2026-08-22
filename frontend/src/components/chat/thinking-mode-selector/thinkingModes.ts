import type { AgentKind } from '@/types/chat.types';

export interface ThinkingModeOption {
  value: string;
  label: string;
}

const THINKING_MODE_ORDER = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const CLAUDE_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];
const CLAUDE_XHIGH_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];
const CLAUDE_XHIGH_MODEL_IDS = new Set(['claude-fable-5', 'claude-opus-5']);
// claude-agent-acp only exposes the effort dial for models that report
// supportsEffort — Haiku doesn't, so hide the selector. Mirrors
// CLAUDE_NO_EFFORT_MODEL_IDS in backend app/services/acp/adapters.py.
const CLAUDE_NO_EFFORT_MODEL_IDS = new Set(['haiku']);

const CODEX_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];
const CODEX_MAX_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];
const CODEX_MAX_MODEL_IDS = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
// Per Codex's model registry, `ultra` (max reasoning + automatic task
// delegation) is supported by Sol/Terra but not Luna.
const CODEX_ULTRA_THINKING_MODES: ThinkingModeOption[] = [
  ...CODEX_MAX_THINKING_MODES,
  { value: 'ultra', label: 'Ultra' },
];
const CODEX_ULTRA_MODEL_IDS = new Set(['gpt-5.6-sol', 'gpt-5.6-terra']);

const COPILOT_MAX_THINKING_MODES = CODEX_MAX_THINKING_MODES;
const COPILOT_MAX_MODEL_IDS = new Set([
  'copilot:claude-sonnet-5',
  'copilot:claude-fable-5',
  'copilot:claude-opus-5',
  'copilot:claude-opus-4.8',
  'copilot:claude-opus-4.8-fast',
  'copilot:claude-opus-4.7',
  'copilot:gpt-5.6-sol',
  'copilot:gpt-5.6-terra',
  'copilot:gpt-5.6-luna',
]);
const COPILOT_NO_XHIGH_THINKING_MODES = CLAUDE_THINKING_MODES;
const COPILOT_NO_XHIGH_MODEL_IDS = new Set([
  'copilot:claude-sonnet-4.6',
  'copilot:claude-opus-4.6',
]);
const COPILOT_XHIGH_THINKING_MODES = CODEX_THINKING_MODES;
const COPILOT_XHIGH_MODEL_IDS = new Set([
  'copilot:gpt-5.5',
  'copilot:gpt-5.4',
  'copilot:gpt-5.4-mini',
  'copilot:gpt-5.3-codex',
]);
const COPILOT_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const COPILOT_REASONING_MODEL_IDS = new Set([
  'copilot:gpt-5-mini',
  'copilot:mai-code-1-flash-picker',
  'copilot:gemini-3.6-flash',
  'copilot:gemini-3.5-flash',
  'copilot:gemini-3.1-pro-preview',
  'copilot:grok-4.5',
]);
const COPILOT_KIMI_K3_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

// Cursor bakes reasoning effort into the model ID; OpenCode delegates to the
// per-model provider. Neither exposes a uniform thinking-mode dial via ACP,
// so an empty list hides the selector.
const EMPTY_THINKING_MODES: ThinkingModeOption[] = [];

// Grok 4.5 has low–high reasoning effort and Grok 4.6 adds xhigh, so the
// selector is model-gated like Claude's xhigh tier.
const GROK_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const GROK_REASONING_MODEL_IDS = new Set(['grok:grok-4.5', 'grok:grok-4.6']);
const GROK_XHIGH_THINKING_MODES: ThinkingModeOption[] = [
  ...GROK_THINKING_MODES,
  { value: 'xhigh', label: 'XHigh' },
];
const GROK_XHIGH_MODEL_IDS = new Set(['grok:grok-4.6']);

const ANTIGRAVITY_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const ANTIGRAVITY_PRO_THINKING_MODES: ThinkingModeOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
];

export const THINKING_MODES_BY_AGENT: Record<AgentKind, ThinkingModeOption[]> = {
  antigravity: ANTIGRAVITY_THINKING_MODES,
  claude: CLAUDE_THINKING_MODES,
  codex: CODEX_THINKING_MODES,
  copilot: EMPTY_THINKING_MODES,
  cursor: EMPTY_THINKING_MODES,
  grok: EMPTY_THINKING_MODES,
  opencode: EMPTY_THINKING_MODES,
};

const DEFAULT_BY_AGENT: Record<AgentKind, string> = {
  antigravity: 'high',
  claude: 'high',
  codex: 'high',
  copilot: 'high',
  cursor: 'high',
  grok: 'high',
  opencode: 'high',
};

export function getThinkingModesForAgent(
  agentKind: AgentKind,
  modelId?: string,
): ThinkingModeOption[] {
  if (agentKind === 'antigravity' && modelId === 'antigravity:gemini-3.1-pro') {
    return ANTIGRAVITY_PRO_THINKING_MODES;
  }
  // Claude gates the effort dial per model: none at all on Haiku, and
  // `xhigh` only on selected high-capability models.
  if (agentKind === 'claude' && modelId && CLAUDE_NO_EFFORT_MODEL_IDS.has(modelId)) {
    return EMPTY_THINKING_MODES;
  }
  if (agentKind === 'claude' && modelId && CLAUDE_XHIGH_MODEL_IDS.has(modelId)) {
    return CLAUDE_XHIGH_THINKING_MODES;
  }
  if (agentKind === 'codex' && modelId && CODEX_ULTRA_MODEL_IDS.has(modelId)) {
    return CODEX_ULTRA_THINKING_MODES;
  }
  if (agentKind === 'codex' && modelId && CODEX_MAX_MODEL_IDS.has(modelId)) {
    return CODEX_MAX_THINKING_MODES;
  }
  if (agentKind === 'copilot' && modelId && COPILOT_MAX_MODEL_IDS.has(modelId)) {
    return COPILOT_MAX_THINKING_MODES;
  }
  if (agentKind === 'copilot' && modelId && COPILOT_NO_XHIGH_MODEL_IDS.has(modelId)) {
    return COPILOT_NO_XHIGH_THINKING_MODES;
  }
  if (agentKind === 'copilot' && modelId && COPILOT_XHIGH_MODEL_IDS.has(modelId)) {
    return COPILOT_XHIGH_THINKING_MODES;
  }
  if (agentKind === 'copilot' && modelId && COPILOT_REASONING_MODEL_IDS.has(modelId)) {
    return COPILOT_THINKING_MODES;
  }
  if (agentKind === 'copilot' && modelId === 'copilot:kimi-k3') {
    return COPILOT_KIMI_K3_THINKING_MODES;
  }
  if (agentKind === 'grok' && modelId && GROK_XHIGH_MODEL_IDS.has(modelId)) {
    return GROK_XHIGH_THINKING_MODES;
  }
  if (agentKind === 'grok' && modelId && GROK_REASONING_MODEL_IDS.has(modelId)) {
    return GROK_THINKING_MODES;
  }

  return THINKING_MODES_BY_AGENT[agentKind];
}

export function coerceThinkingModeForAgent(
  thinkingMode: string,
  agentKind: AgentKind,
  modelId?: string,
): string {
  const modes = getThinkingModesForAgent(agentKind, modelId);
  if (
    agentKind === 'antigravity' &&
    modelId === 'antigravity:gemini-3.1-pro' &&
    thinkingMode === 'medium'
  ) {
    return 'high';
  }
  const requestedMode = THINKING_MODE_ORDER.includes(thinkingMode)
    ? thinkingMode
    : DEFAULT_BY_AGENT[agentKind];
  const exactMode = modes.find((mode) => mode.value === requestedMode);
  if (exactMode) return exactMode.value;

  const requestedIndex = THINKING_MODE_ORDER.indexOf(requestedMode);
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const lowerMode = modes.find((mode) => mode.value === THINKING_MODE_ORDER[index]);
    if (lowerMode) return lowerMode.value;
  }

  return modes[0]?.value ?? DEFAULT_BY_AGENT[agentKind];
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
