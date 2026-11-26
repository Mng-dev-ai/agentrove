import { describe, expect, it } from 'vitest';
import { PERMISSION_MODES } from '@/store/chatSettingsStore';
import backendModes from '@/test/agentPermissionModes.json';
import type { AgentKind } from '@/types/chat.types';
import { coercePermissionModeForAgent, MODES_BY_AGENT } from './permissionModes';

// backend/tests/test_acp.py holds the same file to the backend adapters.
describe('permission modes match the backend adapters', () => {
  it('offers exactly the modes each agent accepts and defaults to one of them', () => {
    const offered = Object.fromEntries(
      Object.entries(MODES_BY_AGENT).map(([kind, modes]) => [
        kind,
        modes.map((mode) => mode.value).sort(),
      ]),
    );

    expect(offered).toEqual(backendModes);
    for (const kind of Object.keys(MODES_BY_AGENT) as AgentKind[]) {
      const foreign = PERMISSION_MODES.find((mode) => !backendModes[kind].includes(mode));
      expect(foreign).toBeDefined();
      expect(backendModes[kind]).toContain(coercePermissionModeForAgent(foreign!, kind));
    }
  });

  it('types exactly the modes the backend accepts', () => {
    expect([...PERMISSION_MODES].sort()).toEqual(
      [...new Set(Object.values(backendModes).flat())].sort(),
    );
  });
});
