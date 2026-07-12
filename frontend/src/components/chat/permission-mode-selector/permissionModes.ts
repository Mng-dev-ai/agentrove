import type { PermissionMode } from '@/store/chatSettingsStore';
import type { AgentKind } from '@/types/chat.types';

export interface PermissionModeOption {
  value: PermissionMode;
  label: string;
  description: string;
}

export const CLAUDE_PERMISSION_MODES: PermissionModeOption[] = [
  { value: 'default', label: 'Default', description: 'Ask before edits and shell actions' },
  {
    value: 'acceptEdits',
    label: 'Accept Edits',
    description: 'Auto-accept edits during the session',
  },
  { value: 'plan', label: 'Plan', description: 'Review steps before running' },
  {
    value: 'bypassPermissions',
    label: 'Bypass Permissions',
    description: 'Skip all permission checks',
  },
];

export const CODEX_PERMISSION_MODES: PermissionModeOption[] = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'Read and write in workspace, ask for higher-risk actions',
  },
  { value: 'read-only', label: 'Read Only', description: 'Read access, ask to write' },
  { value: 'full-access', label: 'Full Access', description: 'Full read and write access' },
];

export const COPILOT_PERMISSION_MODES: PermissionModeOption[] = [
  {
    value: 'agent',
    label: 'Agent',
    description: 'Normal session mode with approvals for gated actions',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Review and refine the plan before execution',
  },
  {
    value: 'autopilot',
    label: 'Autopilot',
    description: 'Autonomous mode for longer multi-step work',
  },
];

export const CURSOR_PERMISSION_MODES: PermissionModeOption[] = [
  {
    value: 'agent',
    label: 'Agent',
    description: 'Full tool access with approvals for gated actions',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Analyze and propose plans without making edits',
  },
  {
    value: 'ask',
    label: 'Ask',
    description: 'Q&A style for explanations and read-only answers',
  },
];

export const GROK_PERMISSION_MODES: PermissionModeOption[] = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'Approves routine tool calls, asks for risky ones',
  },
  {
    value: 'always-approve',
    label: 'Always Approve',
    description: 'Skip all permission prompts',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Blocks edits while Grok designs an approach first',
  },
];

export const OPENCODE_PERMISSION_MODES: PermissionModeOption[] = [
  {
    value: 'build',
    label: 'Build',
    description: 'Full tool access for development work',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Read-only analysis; edits restricted to .opencode/plans/',
  },
];

export const MODES_BY_AGENT: Record<AgentKind, PermissionModeOption[]> = {
  claude: CLAUDE_PERMISSION_MODES,
  codex: CODEX_PERMISSION_MODES,
  copilot: COPILOT_PERMISSION_MODES,
  cursor: CURSOR_PERMISSION_MODES,
  grok: GROK_PERMISSION_MODES,
  opencode: OPENCODE_PERMISSION_MODES,
};

const DEFAULT_BY_AGENT: Record<AgentKind, PermissionMode> = {
  claude: 'bypassPermissions',
  codex: 'full-access',
  copilot: 'agent',
  cursor: 'agent',
  grok: 'always-approve',
  opencode: 'build',
};

export function coercePermissionModeForAgent(
  permissionMode: PermissionMode,
  agentKind: AgentKind,
): PermissionMode {
  const modes = MODES_BY_AGENT[agentKind];
  const defaultMode = DEFAULT_BY_AGENT[agentKind];
  return modes.find((mode) => mode.value === permissionMode) ? permissionMode : defaultMode;
}

export function getPermissionModeOption(
  permissionMode: PermissionMode,
  agentKind: AgentKind,
): PermissionModeOption {
  const modes = MODES_BY_AGENT[agentKind];
  const effectiveMode = coercePermissionModeForAgent(permissionMode, agentKind);
  const selectedMode = modes.find((mode) => mode.value === effectiveMode);

  if (!selectedMode) {
    throw new Error(`Missing permission mode option for ${agentKind}: ${effectiveMode}`);
  }

  return selectedMode;
}
