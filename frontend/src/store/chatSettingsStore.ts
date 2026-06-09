import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'agent'
  | 'autopilot'
  | 'auto'
  | 'read-only'
  | 'full-access'
  | 'ask'
  | 'build';

const DEFAULT_KEY = '__default__';
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'bypassPermissions';
export const DEFAULT_THINKING_MODE: string = 'high';
export const DEFAULT_WORKTREE = false;
export const DEFAULT_PLAN_MODE = false;
export const DEFAULT_PERSONA = 'Default';

interface ChatSettingsState {
  permissionModeByChat: Record<string, PermissionMode>;
  thinkingModeByChat: Record<string, string>;
  worktreeByChat: Record<string, boolean>;
  // Where a new chat runs: locally (false) or on the remote VPS instance (true).
  // Global, not per-chat — chosen at creation time on the landing composer, and
  // cloud chats live on the VPS so they never get a local chat ID to key by.
  runOnCloud: boolean;
  planModeByChat: Record<string, boolean>;
  personaByChat: Record<string, string>;
  setPermissionMode: (chatId: string, mode: PermissionMode) => void;
  setThinkingMode: (chatId: string, mode: string) => void;
  setWorktree: (chatId: string, enabled: boolean) => void;
  setRunOnCloud: (enabled: boolean) => void;
  setPlanMode: (chatId: string, enabled: boolean) => void;
  setPersona: (chatId: string, name: string) => void;
  initChatFromDefaults: (chatId: string) => void;
}

export const useChatSettingsStore = create<ChatSettingsState>()(
  persist(
    (set, get) => ({
      permissionModeByChat: {},
      thinkingModeByChat: {},
      worktreeByChat: {},
      runOnCloud: false,
      planModeByChat: {},
      personaByChat: {},
      setPermissionMode: (chatId, mode) =>
        set((state) => ({
          permissionModeByChat: {
            ...state.permissionModeByChat,
            [chatId]: mode,
          },
        })),
      setThinkingMode: (chatId, mode) =>
        set((state) => ({
          thinkingModeByChat: { ...state.thinkingModeByChat, [chatId]: mode },
        })),
      setWorktree: (chatId, enabled) =>
        set((state) => ({
          worktreeByChat: { ...state.worktreeByChat, [chatId]: enabled },
        })),
      setRunOnCloud: (enabled) => set({ runOnCloud: enabled }),
      setPlanMode: (chatId, enabled) =>
        set((state) => ({
          planModeByChat: { ...state.planModeByChat, [chatId]: enabled },
        })),
      setPersona: (chatId, name) =>
        set((state) => ({
          personaByChat: { ...state.personaByChat, [chatId]: name },
        })),
      // Copies the __default__ settings to a newly created chat so the user's
      // toolbar defaults (permission mode, thinking, worktree, persona) carry
      // over without requiring explicit selection each time. Only reached for
      // local chats — cloud chats live on the VPS and aren't seeded here.
      initChatFromDefaults: (chatId) => {
        const state = get();
        const permission = state.permissionModeByChat[DEFAULT_KEY];
        const thinking = state.thinkingModeByChat[DEFAULT_KEY];
        const worktree = state.worktreeByChat[DEFAULT_KEY];
        const planMode = state.planModeByChat[DEFAULT_KEY];
        const persona = state.personaByChat[DEFAULT_KEY];
        const updates: Partial<
          Pick<
            ChatSettingsState,
            | 'permissionModeByChat'
            | 'thinkingModeByChat'
            | 'worktreeByChat'
            | 'planModeByChat'
            | 'personaByChat'
          >
        > = {};
        if (permission !== undefined) {
          updates.permissionModeByChat = {
            ...state.permissionModeByChat,
            [chatId]: permission,
          };
        }
        if (thinking !== undefined) {
          updates.thinkingModeByChat = { ...state.thinkingModeByChat, [chatId]: thinking };
        }
        if (worktree !== undefined) {
          updates.worktreeByChat = { ...state.worktreeByChat, [chatId]: worktree };
        }
        if (planMode !== undefined) {
          updates.planModeByChat = { ...state.planModeByChat, [chatId]: planMode };
        }
        if (persona !== undefined) {
          updates.personaByChat = { ...state.personaByChat, [chatId]: persona };
        }
        if (Object.keys(updates).length > 0) set(updates);
      },
    }),
    { name: 'chat-settings-storage' },
  ),
);

export { DEFAULT_KEY as DEFAULT_CHAT_SETTINGS_KEY };
export type { PermissionMode };
