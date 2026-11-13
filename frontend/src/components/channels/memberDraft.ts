import { coercePermissionModeForAgent } from '@/components/chat/permission-mode-selector/permissionModes';
import { PERSONAS_SUPPORTED_AGENTS } from '@/components/chat/persona-selector/personaSupport';
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
import type { Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import type { ChannelMember, ChannelMemberCreateRequest } from '@/types/channel.types';

export const MEMBER_NAME_MAX_LENGTH = 32;
const MEMBER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const BROADCAST_MENTIONS = new Set(['all', 'everyone']);

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

export function memberDraftFrom(member: ChannelMember): MemberDraft {
  return {
    key: member.id,
    customName: member.display_name,
    modelId: member.model_id,
    persona: member.persona ?? DEFAULT_PERSONA,
    thinkingMode: member.thinking_mode ?? DEFAULT_THINKING_MODE,
    permissionMode: member.permission_mode,
  };
}

export function resolveMember(member: MemberDraft, models: Model[]) {
  const modelId = resolveModelId(models, member.modelId);
  const model = models.find((m) => m.model_id === modelId);
  const agentKind = model?.agent_kind ?? 'claude';
  return {
    modelId,
    modelName: model?.name ?? modelId,
    agentKind,
    model,
    hasThinking: getThinkingModesForAgent(agentKind, model).length > 0,
    supportsPersona: PERSONAS_SUPPORTED_AGENTS.has(agentKind),
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
      const name = member.customName;
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
