import { describe, expect, it } from 'vitest';
import type { AgentKind, Model } from '@/types/chat.types';
import { getThinkingModesForAgent } from './thinkingModes';

function modeValues(agentKind: AgentKind, flag: Pick<Model, 'accepts_default_thinking_mode'>) {
  return getThinkingModesForAgent(agentKind, {
    model_id: 'model',
    name: 'Model',
    agent_kind: agentKind,
    context_window: null,
    thinking_modes: ['low', 'high'],
    ...flag,
  }).map((mode) => mode.value);
}

describe('getThinkingModesForAgent', () => {
  it('labels a tier this frontend does not know with its raw value', () => {
    const modes = getThinkingModesForAgent('claude', {
      model_id: 'opus',
      name: 'Opus',
      agent_kind: 'claude',
      context_window: null,
      thinking_modes: ['high', 'galaxy'],
    });

    expect(modes).toEqual([
      { value: 'high', label: 'High' },
      { value: 'galaxy', label: 'galaxy' },
    ]);
  });

  it('offers "Default" when the backend says the model accepts it', () => {
    expect(modeValues('claude', { accepts_default_thinking_mode: true })).toEqual([
      'default',
      'low',
      'high',
    ]);
    expect(modeValues('opencode', { accepts_default_thinking_mode: false })).toEqual([
      'low',
      'high',
    ]);
  });

  it('falls back to the agent default when an older backend omits the flag', () => {
    expect(modeValues('opencode', {})).toEqual(['default', 'low', 'high']);
    expect(modeValues('claude', {})).toEqual(['low', 'high']);
  });
});
