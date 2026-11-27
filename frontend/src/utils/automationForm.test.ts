// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Automation, AutomationForm } from '@/types/automation.types';
import type { Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import { automationRequest, formFromAutomation } from './automationForm';

const MODELS: Model[] = [
  {
    model_id: 'claude:opus',
    name: 'Opus',
    agent_kind: 'claude',
    context_window: null,
    thinking_modes: ['low', 'high'],
  },
  {
    model_id: 'cursor:auto',
    name: 'Auto',
    agent_kind: 'cursor',
    context_window: null,
    thinking_modes: [],
  },
];
const PERSONAS: Persona[] = [{ name: 'Reviewer', content: 'Review carefully.' }];
const SCHEDULE = {
  frequency: 'daily',
  everyHours: 6,
  dayOfWeek: 1,
  dayOfMonth: 1,
  time: '09:00',
  cron: '',
} as const;

function automation(overrides: Partial<Automation>): Automation {
  return {
    id: 'automation-1',
    user_id: 'user-1',
    workspace_id: 'workspace-1',
    channel_members: null,
    name: 'Triage',
    prompt: 'Triage new issues.',
    model_id: 'claude:opus',
    cron_expression: '0 9 * * *',
    timezone: 'Europe/Berlin',
    permission_mode: 'plan',
    thinking_mode: 'low',
    worktree: true,
    selected_persona_name: 'Reviewer',
    enabled: false,
    next_run_at: '2026-11-28T08:00:00Z',
    last_run_at: null,
    created_at: '2026-11-27T08:00:00Z',
    updated_at: '2026-11-27T08:00:00Z',
    ...overrides,
  };
}

function form(agents: AutomationForm['agents']): AutomationForm {
  return {
    name: ' Triage ',
    prompt: 'Triage new issues.',
    workspace_id: 'workspace-1',
    agents,
    shared: { thinkingMode: 'low', persona: 'Reviewer', permissionMode: 'acceptEdits' },
    singleMemberChannel: false,
    schedule: SCHEDULE,
    timezone: 'UTC',
    worktree: false,
    machineId: 'local',
  };
}

describe('automation form to request', () => {
  it('sends one agent as a chat automation with the shared settings at the top level', () => {
    const request = automationRequest(
      form([{ key: 'a', modelId: 'claude:opus', customName: null, overrides: {} }]),
      MODELS,
      PERSONAS,
      true,
    );

    expect(request).toEqual({
      name: 'Triage',
      prompt: 'Triage new issues.',
      model_id: 'claude:opus',
      workspace_id: 'workspace-1',
      channel_members: null,
      cron_expression: '0 9 * * *',
      timezone: 'UTC',
      permission_mode: 'acceptEdits',
      thinking_mode: 'low',
      worktree: false,
      selected_persona_name: 'Reviewer',
      enabled: true,
    });
  });

  it('sends several agents as channel members, overrides on top, coerced per model', () => {
    const request = automationRequest(
      form([
        { key: 'a', modelId: 'claude:opus', customName: null, overrides: {} },
        {
          key: 'b',
          modelId: 'claude:opus',
          customName: 'lead',
          overrides: { thinkingMode: 'high' },
        },
        { key: 'c', modelId: 'cursor:auto', customName: null, overrides: {} },
      ]),
      MODELS,
      PERSONAS,
      true,
    );

    expect(request.model_id).toBe('claude:opus');
    expect(request.channel_members).toEqual([
      {
        model_id: 'claude:opus',
        persona: 'Reviewer',
        thinking_mode: 'low',
        permission_mode: 'acceptEdits',
        display_name: undefined,
      },
      {
        model_id: 'claude:opus',
        persona: 'Reviewer',
        thinking_mode: 'high',
        permission_mode: 'acceptEdits',
        display_name: 'lead',
      },
      {
        model_id: 'cursor:auto',
        persona: null,
        thinking_mode: null,
        permission_mode: 'agent',
        display_name: undefined,
      },
    ]);
  });
});

describe('automation to form to request', () => {
  const resave = (stored: Automation) =>
    automationRequest(formFromAutomation(stored, 'local'), MODELS, PERSONAS, stored.enabled);

  it('keeps a chat automation as it was', () => {
    const stored = automation({});

    expect(resave(stored)).toEqual({
      name: 'Triage',
      prompt: 'Triage new issues.',
      model_id: 'claude:opus',
      workspace_id: 'workspace-1',
      channel_members: null,
      cron_expression: '0 9 * * *',
      timezone: 'Europe/Berlin',
      permission_mode: 'plan',
      thinking_mode: 'low',
      worktree: true,
      selected_persona_name: 'Reviewer',
      enabled: false,
    });
  });

  it('keeps every channel member effective settings and names as they were', () => {
    const members = [
      {
        model_id: 'claude:opus',
        display_name: null,
        permission_mode: 'plan' as const,
        persona: null,
        thinking_mode: 'high',
      },
      {
        model_id: 'claude:opus',
        display_name: 'reviewer',
        permission_mode: 'default' as const,
        persona: 'Reviewer',
        thinking_mode: 'low',
      },
      {
        model_id: 'cursor:auto',
        display_name: 'scout',
        permission_mode: 'agent' as const,
        persona: null,
        thinking_mode: null,
      },
    ];

    expect(resave(automation({ channel_members: members })).channel_members).toEqual(
      members.map(({ display_name, ...member }) => ({
        ...member,
        display_name: display_name ?? undefined,
      })),
    );
  });

  it('keeps a one-member channel automation a channel automation', () => {
    const members = [
      {
        model_id: 'claude:opus',
        display_name: 'solo',
        permission_mode: 'plan' as const,
        persona: 'Reviewer',
        thinking_mode: 'low',
      },
    ];

    expect(resave(automation({ channel_members: members })).channel_members).toEqual([
      { ...members[0], display_name: 'solo' },
    ]);
  });
});
