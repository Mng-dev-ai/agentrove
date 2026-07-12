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
    fastModeByChat: {},
    runOnCloud: false,
    personaByChat: {},
  });
});

describe('per-chat setters', () => {
  it('records permission, thinking, worktree, fast mode, and persona keyed by chat', () => {
    state().setPermissionMode('c1', 'plan');
    state().setThinkingMode('c1', 'low');
    state().setWorktree('c1', true);
    state().setFastMode('c1', true);
    state().setPersona('c1', 'Reviewer');

    expect(state().permissionModeByChat.c1).toBe('plan');
    expect(state().thinkingModeByChat.c1).toBe('low');
    expect(state().worktreeByChat.c1).toBe(true);
    expect(state().fastModeByChat.c1).toBe(true);
    expect(state().personaByChat.c1).toBe('Reviewer');
  });

  it('keeps per-chat entries independent', () => {
    state().setPermissionMode('c1', 'plan');
    state().setPermissionMode('c2', 'acceptEdits');
    expect(state().permissionModeByChat).toEqual({ c1: 'plan', c2: 'acceptEdits' });
  });

  it('overwrites an existing chat entry in place', () => {
    state().setWorktree('c1', true);
    state().setWorktree('c1', false);
    expect(state().worktreeByChat.c1).toBe(false);
  });
});

describe('setRunOnCloud', () => {
  it('flips the global cloud flag without touching per-chat maps', () => {
    state().setPermissionMode('c1', 'plan');
    state().setRunOnCloud(true);
    expect(state().runOnCloud).toBe(true);
    expect(state().permissionModeByChat).toEqual({ c1: 'plan' });
  });
});

describe('initChatFromDefaults', () => {
  const seedDefaults = (over: {
    permission?: PermissionMode;
    thinking?: string;
    worktree?: boolean;
    fastMode?: boolean;
    persona?: string;
  }) => {
    if (over.permission !== undefined)
      state().setPermissionMode(DEFAULT_CHAT_SETTINGS_KEY, over.permission);
    if (over.thinking !== undefined)
      state().setThinkingMode(DEFAULT_CHAT_SETTINGS_KEY, over.thinking);
    if (over.worktree !== undefined) state().setWorktree(DEFAULT_CHAT_SETTINGS_KEY, over.worktree);
    if (over.fastMode !== undefined) state().setFastMode(DEFAULT_CHAT_SETTINGS_KEY, over.fastMode);
    if (over.persona !== undefined) state().setPersona(DEFAULT_CHAT_SETTINGS_KEY, over.persona);
  };

  it('copies every set default onto the new chat', () => {
    seedDefaults({
      permission: 'plan',
      thinking: 'low',
      worktree: true,
      fastMode: true,
      persona: 'Reviewer',
    });
    state().initChatFromDefaults('c1');

    expect(state().permissionModeByChat.c1).toBe('plan');
    expect(state().thinkingModeByChat.c1).toBe('low');
    expect(state().worktreeByChat.c1).toBe(true);
    expect(state().fastModeByChat.c1).toBe(true);
    expect(state().personaByChat.c1).toBe('Reviewer');
  });

  it('only seeds the dimensions that have a default set', () => {
    // Just a permission default exists — the other maps stay untouched for c1.
    seedDefaults({ permission: 'plan' });
    state().initChatFromDefaults('c1');

    expect(state().permissionModeByChat.c1).toBe('plan');
    expect('c1' in state().thinkingModeByChat).toBe(false);
    expect('c1' in state().worktreeByChat).toBe(false);
    expect('c1' in state().fastModeByChat).toBe(false);
    expect('c1' in state().personaByChat).toBe(false);
  });

  it('is a no-op when no defaults have been set', () => {
    const before = state();
    state().initChatFromDefaults('c1');
    // No updates object built, so set() never fires and the reference is stable.
    expect(useChatSettingsStore.getState()).toBe(before);
  });

  it('preserves the false worktree default (distinct from unset)', () => {
    // worktree=false is a real default that must copy — the guard keys on
    // `undefined`, not falsiness.
    seedDefaults({ worktree: false });
    state().initChatFromDefaults('c1');
    expect(state().worktreeByChat.c1).toBe(false);
  });

  it('does not disturb other chats when seeding a new one', () => {
    state().setPermissionMode('existing', 'acceptEdits');
    seedDefaults({ permission: 'plan' });
    state().initChatFromDefaults('c1');
    expect(state().permissionModeByChat.existing).toBe('acceptEdits');
    expect(state().permissionModeByChat.c1).toBe('plan');
  });
});
