import { describe, expect, it } from 'vitest';
import { getThinkingModesForAgent } from './thinkingModes';

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
});
