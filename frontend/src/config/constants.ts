import type { CustomAgent } from '@/types/user.types';

export const CONTEXT_WINDOW_TOKENS = 200_000;

export const MAX_MESSAGE_SIZE_BYTES = 100000;

export const MAX_UPLOAD_SIZE_BYTES = {
  AGENT: 100 * 1024,
  COMMAND: 100 * 1024,
  SKILL: 10 * 1024 * 1024,
  CHAT_ATTACHMENT: 5 * 1024 * 1024,
} as const;

export const DROPDOWN_WIDTH = 128;
export const DROPDOWN_HEIGHT = 90;
export const DROPDOWN_MARGIN = 8;

export const BUILT_IN_AGENTS: CustomAgent[] = [
  {
    name: 'Explore',
    description:
      'Fast agent specialized for exploring codebases. Use for finding files by patterns, searching code for keywords, or answering questions about the codebase. Supports thoroughness levels: quick, medium, or very thorough.',
    content: '',
    enabled: true,
    model: 'haiku',
  },
  {
    name: 'Plan',
    description:
      'Agent specialized for codebase planning and architecture analysis. Use for understanding code structure, planning implementations, or exploring dependencies. Supports thoroughness levels: quick, medium, or very thorough.',
    content: '',
    enabled: true,
    model: 'sonnet',
  },
];

export const MOBILE_BREAKPOINT = 768;

export const LAYOUT_CLASSES = {
  ACTIVITY_BAR_WIDTH: 'w-12',
  SIDEBAR_LEFT_WITH_ACTIVITY: 'left-12',
  SIDEBAR_LEFT_WITHOUT_ACTIVITY: 'left-0',
  SIDEBAR_TOGGLE_WITH_ACTIVITY: 'left-[17rem]',
  SIDEBAR_TOGGLE_WITHOUT_ACTIVITY: 'left-60',
  SIDEBAR_TOGGLE_CLOSED_WITH_ACTIVITY: 'left-12',
  SIDEBAR_TOGGLE_CLOSED_WITHOUT_ACTIVITY: 'left-4',
} as const;
