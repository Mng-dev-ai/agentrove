import { coercePermissionModeForAgent } from '@/components/chat/permission-mode-selector/permissionModes';
import {
  coerceThinkingModeForAgent,
  getThinkingModesForAgent,
} from '@/components/chat/thinking-mode-selector/thinkingModes';
import { resolveModelId } from '@/hooks/queries/useModelQueries';
import {
  DEFAULT_PERMISSION_MODE,
  DEFAULT_PERSONA,
  DEFAULT_THINKING_MODE,
  type PermissionMode,
} from '@/store/chatSettingsStore';
import { resolvePersona } from '@/utils/settings';
import {
  getAgentKindForModelId,
  supportsPersona,
  type AgentKind,
  type Model,
} from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import type { ChannelMember, ChannelMemberCreateRequest } from '@/types/channel.types';

export const MEMBER_NAME_MAX_LENGTH = 32;
const MEMBER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const BROADCAST_MENTIONS = new Set(['all', 'everyone']);

export function channelMentionHandles(members: ChannelMember[]): string[] {
  return [...members.map((member) => member.display_name), ...BROADCAST_MENTIONS];
}

export interface MemberDraft {
  key: string;
  customName: string | null;
  modelId: string;
  persona: string;
  thinkingMode: string;
  permissionMode: PermissionMode;
}

export function newMemberDraft(): MemberDraft {
  return {
    key: crypto.randomUUID(),
    customName: null,
    modelId: '',
    persona: DEFAULT_PERSONA,
    thinkingMode: DEFAULT_THINKING_MODE,
    permissionMode: DEFAULT_PERMISSION_MODE,
  };
}

export function memberDraftFrom(member: {
  id?: string;
  model_id: string;
  display_name: string | null;
  persona: string | null;
  thinking_mode: string | null;
  permission_mode: PermissionMode | null;
}): MemberDraft {
  return {
    key: member.id ?? crypto.randomUUID(),
    customName: member.display_name,
    modelId: member.model_id,
    persona: member.persona ?? DEFAULT_PERSONA,
    thinkingMode: member.thinking_mode ?? DEFAULT_THINKING_MODE,
    permissionMode: member.permission_mode ?? DEFAULT_PERMISSION_MODE,
  };
}

export function resolveMember(member: Pick<MemberDraft, 'modelId'>, models: Model[]) {
  const modelId = resolveModelId(models, member.modelId);
  const model = models.find((m) => m.model_id === modelId);
  const agentKind = model?.agent_kind ?? 'claude';
  return {
    modelId,
    modelName: model?.name ?? modelId,
    agentKind,
    model,
    hasThinking: getThinkingModesForAgent(agentKind, model).length > 0,
    supportsPersona: supportsPersona(model, agentKind),
  };
}

function defaultMemberName(modelName: string, agentKind: string): string {
  const slug = modelName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MEMBER_NAME_MAX_LENGTH);
  return slug || agentKind.toLowerCase();
}

export interface MemberName {
  name: string;
  error: string | null;
}

export function resolveMemberNames(
  members: MemberDraft[],
  models: Model[],
  taken = new Set<string>(),
): MemberName[] {
  return members.map((member) => {
    if (member.customName) {
      const name = member.customName.trim();
      if (!MEMBER_NAME_PATTERN.test(name)) {
        return {
          name,
          error: 'Use up to 32 letters, digits, ".", "_" or "-", starting with a letter or digit',
        };
      }
      if (BROADCAST_MENTIONS.has(name.toLowerCase())) {
        return { name, error: `@${name} is reserved for mentioning everyone` };
      }
      if (taken.has(name.toLowerCase())) {
        return { name, error: 'Another member already has this name' };
      }
      taken.add(name.toLowerCase());
      return { name, error: null };
    }
    const { modelName, agentKind } = resolveMember(member, models);
    const base = defaultMemberName(modelName, agentKind);
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) {
      const suffix = `-${n}`;
      name = base.slice(0, MEMBER_NAME_MAX_LENGTH - suffix.length) + suffix;
    }
    taken.add(name.toLowerCase());
    return { name, error: null };
  });
}

export function memberRequest(
  member: MemberDraft,
  models: Model[],
  personas: Persona[],
): ChannelMemberCreateRequest {
  const { modelId, model, agentKind, hasThinking, supportsPersona } = resolveMember(member, models);
  return {
    model_id: modelId,
    persona:
      supportsPersona && resolvePersona(member.persona, personas) !== DEFAULT_PERSONA
        ? member.persona
        : null,
    thinking_mode: hasThinking
      ? coerceThinkingModeForAgent(member.thinkingMode, agentKind, model)
      : null,
    permission_mode: coercePermissionModeForAgent(member.permissionMode, agentKind),
    display_name: member.customName || undefined,
  };
}

export type MemberSetting = 'thinkingMode' | 'persona' | 'permissionMode';
export type SharedMemberSettings = Pick<MemberDraft, MemberSetting>;

// A member of a group thread being composed: the shared settings (the New thread modal's
// "All agents") apply to it unless it overrides them.
export interface GroupMember {
  key: string;
  modelId: string;
  customName: string | null;
  overrides: Partial<SharedMemberSettings>;
}

export function newGroupMember(modelId: string): GroupMember {
  return { key: crypto.randomUUID(), modelId, customName: null, overrides: {} };
}

export function groupMemberDraft(member: GroupMember, shared: SharedMemberSettings): MemberDraft {
  return {
    key: member.key,
    customName: member.customName,
    modelId: member.modelId,
    ...shared,
    ...member.overrides,
  };
}

export function groupMemberRequests(
  members: GroupMember[],
  shared: SharedMemberSettings,
  models: Model[],
  personas: Persona[],
): { requests: ChannelMemberCreateRequest[]; names: MemberName[] } {
  const drafts = members.map((member) => groupMemberDraft(member, shared));
  return {
    requests: drafts.map((draft) => memberRequest(draft, models, personas)),
    names: resolveMemberNames(drafts, models),
  };
}

export function mixedMemberSettings(
  members: GroupMember[],
  shared: SharedMemberSettings,
): Record<MemberSetting, boolean> {
  const isMixed = (setting: MemberSetting) =>
    members.some(
      ({ overrides }) => overrides[setting] !== undefined && overrides[setting] !== shared[setting],
    );
  return {
    thinkingMode: isMixed('thinkingMode'),
    persona: isMixed('persona'),
    permissionMode: isMixed('permissionMode'),
  };
}

export function patchGroupMember(member: GroupMember, patch: Partial<MemberDraft>): GroupMember {
  const overrides = { ...member.overrides };
  if (patch.thinkingMode !== undefined) overrides.thinkingMode = patch.thinkingMode;
  if (patch.persona !== undefined) overrides.persona = patch.persona;
  if (patch.permissionMode !== undefined) overrides.permissionMode = patch.permissionMode;
  return {
    ...member,
    modelId: patch.modelId ?? member.modelId,
    customName: patch.customName !== undefined ? patch.customName : member.customName,
    overrides,
  };
}

// The model a member's settings follow. A channel member resolves as memberRequest sends
// it; a chat's model is saved as chosen, so an unlisted one only has the agent kind its id
// implies.
export function settingsModel(
  modelId: string,
  models: Model[],
  channel: boolean,
): { agentKind: AgentKind; model: Model | undefined } {
  if (channel) {
    const { agentKind, model } = resolveMember({ modelId }, models);
    return { agentKind, model };
  }
  const model = models.find((m) => m.model_id === modelId);
  return { agentKind: model?.agent_kind ?? getAgentKindForModelId(modelId), model };
}

// A stored member carries a default for settings its model lacks; that is no choice to
// show, mix or promote, so only the settings the model has count as overrides. Without a
// model (the list still loading) nothing is known to be missing.
export function withSupportedOverrides(members: GroupMember[], models: Model[]): GroupMember[] {
  return members.map((member) => {
    const { model, hasThinking, supportsPersona } = resolveMember(member, models);
    if (!model) return member;
    const overrides = { ...member.overrides };
    if (!hasThinking) delete overrides.thinkingMode;
    if (!supportsPersona) delete overrides.persona;
    return { ...member, overrides };
  });
}

// A sole agent runs on the shared settings, so a list shrinking to one promotes that
// agent's overrides to them: what runs is what the agent had.
export function promoteSoleMemberOverrides(
  members: GroupMember[],
  models: Model[],
): { members: GroupMember[]; promoted: Partial<SharedMemberSettings> } {
  if (members.length > 1) return { members, promoted: {} };
  const [member] = withSupportedOverrides(members, models);
  return { members: [{ ...member, overrides: {} }], promoted: member.overrides };
}

export function clearMemberOverrides(
  members: GroupMember[],
  setting: MemberSetting,
): GroupMember[] {
  return members.map((member) => {
    if (member.overrides[setting] === undefined) return member;
    const overrides = { ...member.overrides };
    delete overrides[setting];
    return { ...member, overrides };
  });
}
