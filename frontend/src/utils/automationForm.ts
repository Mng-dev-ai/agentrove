import {
  groupMemberRequests,
  memberDraftFrom,
  newGroupMember,
  type GroupMember,
  type MemberDraft,
  type SharedMemberSettings,
} from '@/components/channels/memberDraft';
import {
  DEFAULT_PERMISSION_MODE,
  DEFAULT_PERSONA,
  DEFAULT_THINKING_MODE,
  DEFAULT_WORKTREE,
} from '@/store/chatSettingsStore';
import { buildAgentChatFields } from '@/utils/chatRequest';
import {
  buildCronExpression,
  DEFAULT_SCHEDULE,
  parseCronExpression,
} from '@/utils/automationSchedule';
import type { Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import type { Automation, AutomationCreateRequest, AutomationForm } from '@/types/automation.types';

export function createDefaultForm(machineId: string): AutomationForm {
  return {
    name: '',
    prompt: '',
    workspace_id: '',
    agents: [newGroupMember('')],
    shared: {
      thinkingMode: DEFAULT_THINKING_MODE,
      persona: DEFAULT_PERSONA,
      permissionMode: DEFAULT_PERMISSION_MODE,
    },
    singleMemberChannel: false,
    schedule: { ...DEFAULT_SCHEDULE },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    worktree: DEFAULT_WORKTREE,
    machineId,
  };
}

// Members store full settings, so the first member's values become the shared ones and
// every other member keeps what differs as overrides.
function groupFromMembers(drafts: MemberDraft[]): {
  agents: GroupMember[];
  shared: SharedMemberSettings;
} {
  const [first] = drafts;
  const shared: SharedMemberSettings = {
    thinkingMode: first.thinkingMode,
    persona: first.persona,
    permissionMode: first.permissionMode,
  };
  const agents = drafts.map((draft) => {
    const overrides: GroupMember['overrides'] = {};
    if (draft.thinkingMode !== shared.thinkingMode) overrides.thinkingMode = draft.thinkingMode;
    if (draft.persona !== shared.persona) overrides.persona = draft.persona;
    if (draft.permissionMode !== shared.permissionMode)
      overrides.permissionMode = draft.permissionMode;
    return { key: draft.key, modelId: draft.modelId, customName: draft.customName, overrides };
  });
  return { agents, shared };
}

export function formFromAutomation(automation: Automation, machineId: string): AutomationForm {
  const group = automation.channel_members
    ? groupFromMembers(automation.channel_members.map(memberDraftFrom))
    : {
        agents: [newGroupMember(automation.model_id)],
        shared: {
          thinkingMode: automation.thinking_mode ?? '',
          persona: automation.selected_persona_name,
          permissionMode: automation.permission_mode,
        },
      };
  return {
    name: automation.name,
    prompt: automation.prompt,
    workspace_id: automation.workspace_id,
    ...group,
    singleMemberChannel: automation.channel_members?.length === 1,
    schedule: parseCronExpression(automation.cron_expression),
    // Keep the zone the schedule was authored in — editing from another
    // timezone must not silently shift the automation's wall-clock time.
    timezone: automation.timezone,
    worktree: automation.worktree,
    machineId,
  };
}

export function isChannelForm(form: AutomationForm): boolean {
  return form.agents.length > 1 || form.singleMemberChannel;
}

export function automationRequest(
  form: AutomationForm,
  models: Model[],
  personas: Persona[],
  enabled: boolean,
): AutomationCreateRequest {
  // A channel run ignores the top-level agent fields; they follow the first agent so the
  // backend's model check on create passes.
  const modelId = form.agents[0].modelId;
  // Coerce raw form settings to the model's agent, same as normal sends — a stale mode
  // from another agent family would fail at run time.
  const agentFields = buildAgentChatFields(
    modelId,
    new Map(models.map((model) => [model.model_id, model])),
    {
      permissionMode: form.shared.permissionMode,
      thinkingMode: form.shared.thinkingMode,
      worktree: form.worktree,
      // Automations don't expose a Fast mode control yet.
      fastMode: false,
      persona: form.shared.persona,
    },
    personas,
  );
  return {
    name: form.name.trim(),
    prompt: form.prompt,
    model_id: modelId,
    workspace_id: form.workspace_id,
    cron_expression: buildCronExpression(form.schedule),
    timezone: form.timezone,
    permission_mode: agentFields.permission_mode,
    thinking_mode: agentFields.thinking_mode || null,
    worktree: agentFields.worktree ?? false,
    selected_persona_name: agentFields.selected_persona_name,
    enabled,
    channel_members: isChannelForm(form)
      ? groupMemberRequests(form.agents, form.shared, models, personas).requests
      : null,
  };
}
