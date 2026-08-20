import type { ComponentType, SVGProps } from 'react';
import type { AgentKind } from '@/types/chat.types';
import { ClaudeIcon } from './ClaudeIcon';
import { CodexIcon } from './CodexIcon';
import { CopilotIcon } from './CopilotIcon';
import { CursorIcon } from './CursorIcon';
import { GrokIcon } from './GrokIcon';
import { OpencodeIcon } from './OpencodeIcon';

export const AGENT_ICONS: Record<AgentKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  copilot: CopilotIcon,
  cursor: CursorIcon,
  grok: GrokIcon,
  opencode: OpencodeIcon,
};
