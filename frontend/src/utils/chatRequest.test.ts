import { describe, it, expect } from 'vitest';
import { buildAgentChatFields } from './chatRequest';
import type { Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';

const model = (
  over: Partial<Model> & { model_id: string; agent_kind: Model['agent_kind'] },
): Model => ({
  name: over.model_id,
  context_window: null,
  ...over,
});

const raw = (over: Partial<Parameters<typeof buildAgentChatFields>[2]> = {}) => ({
  permissionMode: 'bypassPermissions' as const,
  thinkingMode: 'high',
  worktree: false,
  baseBranch: undefined,
  fastMode: false,
  persona: 'Default',
  ...over,
});

describe('buildAgentChatFields', () => {
  it('resolves the agent kind from the model map and coerces an incompatible permission mode', () => {
    const map = new Map<string, Model>([['m1', model({ model_id: 'm1', agent_kind: 'codex' })]]);
    const fields = buildAgentChatFields(
      'm1',
      map,
      raw({ permissionMode: 'bypassPermissions' }),
      [],
    );
    // 'bypassPermissions' is a Claude mode -> falls back to the codex default.
    expect(fields.permission_mode).toBe('full-access');
  });

  it('falls back to model-id conventions when the model map lacks the id', () => {
    const fields = buildAgentChatFields(
      'gpt-5.5',
      new Map(),
      raw({ permissionMode: 'default' }),
      [],
    );
    // gpt-5.5 is a known codex id -> coerced to the codex default.
    expect(fields.permission_mode).toBe('full-access');
  });

  it('keeps a valid permission and thinking mode for a claude model', () => {
    const fields = buildAgentChatFields(
      'claude-sonnet-5',
      new Map(),
      raw({ permissionMode: 'plan', thinkingMode: 'max' }),
      [],
    );
    expect(fields.permission_mode).toBe('plan');
    expect(fields.thinking_mode).toBe('max');
  });

  it('coerces a thinking mode the model does not support to the agent default', () => {
    // gpt-5.5 (codex, non-max) has no 'max' tier -> falls back to 'high'.
    const fields = buildAgentChatFields('gpt-5.5', new Map(), raw({ thinkingMode: 'max' }), []);
    expect(fields.thinking_mode).toBe('high');
  });

  it('maps worktree to true only when enabled, else undefined', () => {
    const on = buildAgentChatFields('claude-x', new Map(), raw({ worktree: true }), []);
    const off = buildAgentChatFields('claude-x', new Map(), raw({ worktree: false }), []);
    expect(on.worktree).toBe(true);
    expect(off.worktree).toBeUndefined();
  });

  it('sends base_branch only when a worktree is being created this turn', () => {
    const worktreeWithBase = buildAgentChatFields(
      'claude-x',
      new Map(),
      raw({ worktree: true, baseBranch: 'develop' }),
      [],
    );
    const worktreeNoBase = buildAgentChatFields(
      'claude-x',
      new Map(),
      raw({ worktree: true, baseBranch: undefined }),
      [],
    );
    const baseWithoutWorktree = buildAgentChatFields(
      'claude-x',
      new Map(),
      raw({ worktree: false, baseBranch: 'develop' }),
      [],
    );
    expect(worktreeWithBase.base_branch).toBe('develop');
    expect(worktreeNoBase.base_branch).toBeUndefined();
    // A stale base can't leak onto a turn that isn't cutting a worktree.
    expect(baseWithoutWorktree.base_branch).toBeUndefined();
  });

  it('sends fast_mode only for Codex when enabled', () => {
    const codexOn = buildAgentChatFields('gpt-5.5', new Map(), raw({ fastMode: true }), []);
    const codexOff = buildAgentChatFields('gpt-5.5', new Map(), raw({ fastMode: false }), []);
    const claudeOn = buildAgentChatFields('claude-x', new Map(), raw({ fastMode: true }), []);
    expect(codexOn.fast_mode).toBe(true);
    expect(codexOff.fast_mode).toBeUndefined();
    expect(claudeOn.fast_mode).toBeUndefined();
  });

  it('keeps a known custom persona and drops an unknown one back to Default', () => {
    const personas: Persona[] = [{ name: 'Reviewer', content: '' }];
    const known = buildAgentChatFields(
      'claude-x',
      new Map(),
      raw({ persona: 'Reviewer' }),
      personas,
    );
    const unknown = buildAgentChatFields(
      'claude-x',
      new Map(),
      raw({ persona: 'Ghost' }),
      personas,
    );
    expect(known.selected_persona_name).toBe('Reviewer');
    expect(unknown.selected_persona_name).toBe('Default');
  });
});
