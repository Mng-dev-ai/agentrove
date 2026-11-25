import { describe, expect, it } from 'vitest';
import { resolveAgentKind, supportsPersona, type Model } from './chat.types';

const model = (over: Partial<Model> & Pick<Model, 'model_id' | 'agent_kind'>): Model => ({
  name: over.model_id,
  context_window: null,
  thinking_modes: [],
  ...over,
});

describe('resolveAgentKind', () => {
  it('takes the agent kind from the catalog for an id the static conventions miss', () => {
    const catalog = new Map([
      ['gpt-7-test', model({ model_id: 'gpt-7-test', agent_kind: 'codex' })],
    ]);
    expect(resolveAgentKind(catalog, 'gpt-7-test')).toBe('codex');
    expect(resolveAgentKind(new Map(), 'gpt-7-test')).toBe('claude');
    expect(resolveAgentKind(new Map(), 'gpt-5.5')).toBe('codex');
  });
});

describe('supportsPersona', () => {
  it('follows supports_persona and falls back to the agent kind when it is absent', () => {
    const cursor = model({ model_id: 'cursor:auto', agent_kind: 'cursor' });
    expect(supportsPersona({ ...cursor, supports_persona: true }, 'cursor')).toBe(true);
    expect(supportsPersona(cursor, 'cursor')).toBe(false);
    const claude = model({ model_id: 'claude-x', agent_kind: 'claude' });
    expect(supportsPersona({ ...claude, supports_persona: false }, 'claude')).toBe(false);
    expect(supportsPersona(undefined, 'claude')).toBe(true);
  });
});
