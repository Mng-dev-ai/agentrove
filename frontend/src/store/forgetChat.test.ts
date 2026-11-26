// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_SETTINGS_KEY, useChatSettingsStore } from '@/store/chatSettingsStore';
import { forgetChat, forgetChatsForMachines } from '@/store/forgetChat';
import {
  assignChatsToMachine,
  chatMachineId,
  claimRemovedMachineOrigins,
  forgetChatOrigins,
  recordRemovedMachine,
} from '@/store/machineOrigin';
import { useMachineStore } from '@/store/machineStore';
import { DEFAULT_MODEL_KEY, useModelStore } from '@/store/modelStore';
import { useUIStore } from '@/store/uiStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { terminalStorageKey } from '@/utils/terminal';

const REMOTE_ID = 'machine-remote';
const SETTINGS_MAPS = [
  'permissionModeByChat',
  'thinkingModeByChat',
  'worktreeByChat',
  'worktreeBaseBranchByChat',
  'fastModeByChat',
  'personaByChat',
] as const;

const machine = (id: string) => ({ id, name: id, url: `https://${id}.test`, pairing: null });

const persisted = (key: string): string => localStorage.getItem(key) ?? '';

function seedChat(chatId: string): void {
  const settings = useChatSettingsStore.getState();
  settings.setPermissionMode(chatId, 'plan');
  settings.setThinkingMode(chatId, 'low');
  settings.setWorktree(chatId, true);
  settings.setWorktreeBaseBranch(chatId, 'develop');
  settings.setFastMode(chatId, true);
  settings.setPersona(chatId, 'Reviewer');
  useModelStore.getState().selectModel(chatId, 'gpt-5');
  useUIStore.setState((state) => ({
    editorByChat: { ...state.editorByChat, [chatId]: { open: ['a.ts'], selected: 'a.ts' } },
    chatTabs: [...state.chatTabs, chatId],
    splitSessionPanelChatIds: [...state.splitSessionPanelChatIds, chatId],
  }));
  localStorage.setItem(terminalStorageKey(chatId, 'main'), '1');
}

function expectChatState(chatId: string, present: boolean): void {
  const settings = useChatSettingsStore.getState();
  for (const map of SETTINGS_MAPS) expect(chatId in settings[map], map).toBe(present);
  expect(chatId in useModelStore.getState().modelByChat).toBe(present);
  const ui = useUIStore.getState();
  expect(chatId in ui.editorByChat).toBe(present);
  expect(ui.chatTabs.includes(chatId)).toBe(present);
  expect(ui.splitSessionPanelChatIds.includes(chatId)).toBe(present);
  expect(localStorage.getItem(terminalStorageKey(chatId, 'main')) !== null).toBe(present);
  for (const key of ['chat-settings-storage', 'model-storage', 'ui-storage']) {
    expect(persisted(key).includes(`"${chatId}"`), key).toBe(present);
  }
}

beforeEach(() => {
  forgetChatOrigins(() => true);
  localStorage.clear();
  useMachineStore.setState({ machines: [machine(REMOTE_ID)], connections: {} });
  useChatSettingsStore.setState({
    permissionModeByChat: {},
    thinkingModeByChat: {},
    worktreeByChat: {},
    worktreeBaseBranchByChat: {},
    fastModeByChat: {},
    personaByChat: {},
    targetMachineId: null,
  });
  useModelStore.setState({ modelByChat: {}, favoriteModelIds: [] });
  useUIStore.setState({
    editorByChat: {},
    layoutsByChat: {},
    chatTabs: [],
    splitSessionPanelChatIds: [],
    currentWorkspaceChatId: null,
  });
});

describe('forgetChat', () => {
  it('removes every persisted entry of the chat and leaves other chats alone', () => {
    seedChat('chat-gone');
    seedChat('chat-kept');
    assignChatsToMachine(REMOTE_ID, ['chat-gone', 'chat-kept']);

    forgetChat('chat-gone');

    expectChatState('chat-gone', false);
    expectChatState('chat-kept', true);
    expect(chatMachineId('chat-gone')).toBe(LOCAL_MACHINE_ID);
    expect(chatMachineId('chat-kept')).toBe(REMOTE_ID);

    assignChatsToMachine(REMOTE_ID, ['chat-later']);
    expect(persisted('machine-chat-origins')).not.toContain('chat-gone');
    expect(persisted('machine-chat-origins')).toContain('chat-kept');
  });

  it('keeps defaults, global choices and removed-machine claims through both forgets', () => {
    seedChat(DEFAULT_CHAT_SETTINGS_KEY);
    useModelStore.getState().selectModel(DEFAULT_MODEL_KEY, 'gpt-5');
    seedChat('chat-local');
    useChatSettingsStore.getState().setTargetMachine(REMOTE_ID);
    useChatSettingsStore.getState().setWorktreeBaseBranch(DEFAULT_CHAT_SETTINGS_KEY, 'develop');
    useModelStore.getState().toggleFavoriteModel('gpt-5');
    assignChatsToMachine(REMOTE_ID, ['chat-orphan', 'chat-orphan-gone']);
    useMachineStore.setState({ machines: [] });
    recordRemovedMachine(REMOTE_ID, { instanceId: 'instance-1' });

    forgetChat('chat-orphan-gone');
    forgetChatsForMachines(new Set([LOCAL_MACHINE_ID]), new Set());

    expectChatState('chat-local', false);
    const settings = useChatSettingsStore.getState();
    for (const map of SETTINGS_MAPS) expect(DEFAULT_CHAT_SETTINGS_KEY in settings[map]).toBe(true);
    expect(settings.targetMachineId).toBe(REMOTE_ID);
    expect(useModelStore.getState().favoriteModelIds).toEqual(['gpt-5']);
    expect(useModelStore.getState().modelByChat[DEFAULT_MODEL_KEY]).toBe('gpt-5');
    expect(chatMachineId('chat-orphan')).toBe(REMOTE_ID);

    useMachineStore.setState({ machines: [machine('machine-repaired')] });
    claimRemovedMachineOrigins('machine-repaired', [{ instanceId: 'instance-1' }]);
    expect(chatMachineId('chat-orphan')).toBe('machine-repaired');
    expect(chatMachineId('chat-orphan-gone')).toBe(LOCAL_MACHINE_ID);
  });
});

describe('forgetChatsForMachines', () => {
  it('forgets only the chats of machines whose wipe succeeded', () => {
    for (const chatId of ['chat-unmapped', 'chat-local', 'chat-member', 'chat-remote']) {
      seedChat(chatId);
    }
    assignChatsToMachine(LOCAL_MACHINE_ID, ['chat-local', 'chat-member']);
    assignChatsToMachine(REMOTE_ID, ['chat-remote']);
    const remoteLayout = { openTabs: ['agent:primary' as const], visibleLayout: [] };
    useUIStore.setState({
      currentWorkspaceChatId: 'chat-remote',
      layoutsByChat: { 'chat-remote': remoteLayout, 'chat-local': remoteLayout },
    });

    forgetChatsForMachines(new Set([LOCAL_MACHINE_ID]), new Set(['chat-member']));

    expectChatState('chat-unmapped', false);
    expectChatState('chat-local', false);
    expectChatState('chat-member', true);
    expectChatState('chat-remote', true);
    expect(useUIStore.getState().currentWorkspaceChatId).toBe('chat-remote');
    expect(Object.keys(useUIStore.getState().layoutsByChat)).toEqual(['chat-remote']);
    expect(chatMachineId('chat-remote')).toBe(REMOTE_ID);
    expect(persisted('machine-chat-origins')).not.toContain('chat-local');
    expect(persisted('machine-chat-origins')).toContain('chat-member');
  });
});
