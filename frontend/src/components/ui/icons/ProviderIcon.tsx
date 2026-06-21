import type { ComponentType, SVGProps } from 'react';
import { ClaudeIcon } from './ClaudeIcon';
import { CodexIcon } from './CodexIcon';
import { CopilotIcon } from './CopilotIcon';
import { CursorIcon } from './CursorIcon';
import { OpencodeIcon } from './OpencodeIcon';
import type { AgentKind } from '@/types/chat.types';

export const AGENT_ICONS: Record<AgentKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  copilot: CopilotIcon,
  cursor: CursorIcon,
  opencode: OpencodeIcon,
};

interface ProviderIconProps extends SVGProps<SVGSVGElement> {
  agentKind: AgentKind;
}

export function ProviderIcon({ agentKind, ...props }: ProviderIconProps) {
  const Icon = AGENT_ICONS[agentKind];
  return <Icon aria-hidden {...props} />;
}
