// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  type PermissionMode,
} from './chatSettingsStore';

const state = () => useChatSettingsStore.getState();

beforeEach(() => {
  localStorage.clear();
  useChatSettingsStore.setState({
    permissionModeByChat: {},
    thinkingModeByChat: {},
    worktreeByChat: {},
    worktreeBaseBranchByChat: {},
    fastModeByChat: {},
    runOnCloud: false,
    personaByChat: {},
  });
});

describe('setWorktreeBaseBranch', () => {
  it('deletes the key when cleared so the shape matches a rehydrated store', () => {
    state().setWorktreeBaseBranch('c1', 'develop');
    expect(state().worktreeBaseBranchByChat.c1).toBe('develop');
    state().setWorktreeBaseBranch('c1', undefined);
    expect('c1' in state().worktreeBaseBranchByChat).toBe(false);
  });
});

describe('setRunOnCloud', () => {
  it('resets the default base branch when switching target, keeping per-chat bases', () => {
    state().setWorktreeBaseBranch(DEFAULT_CHAT_SETTINGS_KEY, 'develop');
    state().setWorktreeBaseBranch('c1', 'feature');

    state().setRunOnCloud(true);

    expect(state().runOnCloud).toBe(true);
    expect(state().worktreeBaseBranchByChat).toEqual({ c1: 'feature' });
  });

  it('keeps the default base branch when the flag does not change', () => {
    state().setWorktreeBaseBranch(DEFAULT_CHAT_SETTINGS_KEY, 'develop');
    state().setRunOnCloud(false);
    expect(state().worktreeBaseBranchByChat[DEFAULT_CHAT_SETTINGS_KEY]).toBe('develop');
  });
});

describe('initChatFromDefaults', () => {
  const seedDefaults = (over: {
    permission?: PermissionMode;
    thinking?: string;
    worktree?: boolean;
    baseBranch?: string;
    fastMode?: boolean;
    persona?: string;
  }) => {
    if (over.permission !== undefined)
      state().setPermissionMode(DEFAULT_CHAT_SETTINGS_KEY, over.permission);
    if (over.thinking !== undefined)
      state().setThinkingMode(DEFAULT_CHAT_SETTINGS_KEY, over.thinking);
    if (over.worktree !== undefined) state().setWorktree(DEFAULT_CHAT_SETTINGS_KEY, over.worktree);
    if (over.baseBranch !== undefined)
      state().setWorktreeBaseBranch(DEFAULT_CHAT_SETTINGS_KEY, over.baseBranch);
    if (over.fastMode !== undefined) state().setFastMode(DEFAULT_CHAT_SETTINGS_KEY, over.fastMode);
    if (over.persona !== undefined) state().setPersona(DEFAULT_CHAT_SETTINGS_KEY, over.persona);
  };

  it('copies every set default onto the new chat without disturbing other chats', () => {
    state().setPermissionMode('existing', 'acceptEdits');
    seedDefaults({
      permission: 'plan',
      thinking: 'low',
      worktree: true,
      baseBranch: 'develop',
      fastMode: true,
      persona: 'Reviewer',
    });
    state().initChatFromDefaults('c1');

    expect(state().permissionModeByChat.c1).toBe('plan');
    expect(state().thinkingModeByChat.c1).toBe('low');
    expect(state().worktreeByChat.c1).toBe(true);
    expect(state().worktreeBaseBranchByChat.c1).toBe('develop');
    expect(state().fastModeByChat.c1).toBe(true);
    expect(state().personaByChat.c1).toBe('Reviewer');
    expect(state().permissionModeByChat.existing).toBe('acceptEdits');
  });

  it('only seeds the dimensions that have a default set', () => {
    seedDefaults({ permission: 'plan' });
    state().initChatFromDefaults('c1');

    expect(state().permissionModeByChat.c1).toBe('plan');
    expect('c1' in state().thinkingModeByChat).toBe(false);
    expect('c1' in state().worktreeByChat).toBe(false);
    expect('c1' in state().worktreeBaseBranchByChat).toBe(false);
    expect('c1' in state().fastModeByChat).toBe(false);
    expect('c1' in state().personaByChat).toBe(false);
  });

  it('is a no-op when no defaults have been set', () => {
    const before = state();
    state().initChatFromDefaults('c1');
    expect(useChatSettingsStore.getState()).toBe(before);
  });

  it('copies a false worktree default rather than treating it as unset', () => {
    seedDefaults({ worktree: false });
    state().initChatFromDefaults('c1');
    expect(state().worktreeByChat.c1).toBe(false);
  });
});
