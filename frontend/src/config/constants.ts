import type { AgentKind } from '@/types/chat.types';
import type { SlashCommand } from '@/types/ui.types';

export const CONTEXT_WINDOW_TOKENS = 200_000;

export const MAX_DIFF_LENGTH = 150_000;

export const MAX_MESSAGE_SIZE_BYTES = 100000;

export const DROPDOWN_WIDTH = 128;
export const DROPDOWN_HEIGHT = 90;
export const DROPDOWN_MARGIN = 8;

export const MONACO_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const MOBILE_BREAKPOINT = 768;

export const EMPTY_BUILTIN_COMMANDS: Record<AgentKind, SlashCommand[]> = {
  antigravity: [],
  claude: [],
  codex: [],
  copilot: [],
  cursor: [],
  grok: [],
  opencode: [],
};

export const MACHINE_CHATS_PER_PAGE = 25;
export const SHOW_MORE_MAX_PAGE_ROUNDS = 3;
