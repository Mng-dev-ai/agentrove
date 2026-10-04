import { useState } from 'react';
import { Hash, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { SelectorDot } from '@/components/ui/primitives/SelectorDot/SelectorDot';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeDropdown } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { PersonaDropdown } from '@/components/chat/persona-selector/PersonaSelector';
import { PERSONAS_SUPPORTED_AGENTS } from '@/components/chat/persona-selector/personaSupport';
import { WorkspaceSelector } from '@/components/chat/workspace-selector/WorkspaceSelector';
import {
  coerceThinkingModeForAgent,
  getThinkingModesForAgent,
} from '@/components/chat/thinking-mode-selector/thinkingModes';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { useCreateChannelMutation } from '@/hooks/queries/useChannelQueries';
import { DEFAULT_PERSONA, DEFAULT_THINKING_MODE } from '@/store/chatSettingsStore';
import { useAuthStore } from '@/store/authStore';
import type { Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import type { ChannelMemberCreateRequest } from '@/types/channel.types';
import styles from './CreateChannelDialog.module.scss';

interface MemberDraft {
  key: string;
  modelId: string;
  persona: string;
  thinkingMode: string;
}

function newMemberDraft(): MemberDraft {
  return {
    key: crypto.randomUUID(),
    modelId: '',
    persona: DEFAULT_PERSONA,
    thinkingMode: DEFAULT_THINKING_MODE,
  };
}

function resolveMember(member: MemberDraft, models: Model[]) {
  const modelId = member.modelId || models[0]?.model_id || '';
  const agentKind = models.find((m) => m.model_id === modelId)?.agent_kind ?? 'claude';
  return {
    modelId,
    agentKind,
    hasThinking: getThinkingModesForAgent(agentKind, modelId).length > 0,
    supportsPersona: PERSONAS_SUPPORTED_AGENTS.has(agentKind),
  };
}

interface MemberRowProps {
  member: MemberDraft;
  models: Model[];
  personas: Persona[];
  canRemove: boolean;
  onChange: (patch: Partial<MemberDraft>) => void;
  onRemove: () => void;
}

function MemberRow({ member, models, personas, canRemove, onChange, onRemove }: MemberRowProps) {
  const { modelId, agentKind, hasThinking, supportsPersona } = resolveMember(member, models);
  const showPersona = supportsPersona && personas.length > 0;

  return (
    <div className={styles.member}>
      <ProviderIcon agentKind={agentKind} className={styles['member-icon']} />
      <div className={styles['member-controls']}>
        <ModelSelector
          selectedModelId={modelId}
          onModelChange={(next) => onChange({ modelId: next })}
          dropdownPosition="bottom"
          variant="text"
        />
        {hasThinking && (
          <>
            <SelectorDot />
            <ThinkingModeDropdown
              value={member.thinkingMode}
              onChange={(thinkingMode) => onChange({ thinkingMode })}
              agentKind={agentKind}
              modelId={modelId}
              dropdownPosition="bottom"
              variant="text"
            />
          </>
        )}
        {showPersona && (
          <>
            <SelectorDot />
            <PersonaDropdown
              personas={personas}
              value={member.persona}
              onChange={(persona) => onChange({ persona })}
              dropdownPosition="bottom"
              variant="text"
            />
          </>
        )}
      </div>
      {canRemove && (
        <Button
          type="button"
          variant="unstyled"
          onClick={onRemove}
          className={styles['remove-btn']}
          aria-label="Remove member"
        >
          <X className={styles['remove-icon']} />
        </Button>
      )}
    </div>
  );
}

interface CreateChannelDialogProps {
  defaultWorkspaceId: string | null;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}

export function CreateChannelDialog({
  defaultWorkspaceId,
  onClose,
  onCreated,
}: CreateChannelDialogProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: models = [] } = useModelsQuery({ enabled: isAuthenticated });
  const { data: settings } = useSettingsQuery({ enabled: isAuthenticated });
  const personas = settings?.personas ?? [];

  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId);
  const [members, setMembers] = useState<MemberDraft[]>(() => [newMemberDraft()]);
  const createChannel = useCreateChannelMutation();

  const updateMember = (key: string, patch: Partial<MemberDraft>) =>
    setMembers((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Please enter a channel name');
      return;
    }
    if (!workspaceId) {
      toast.error('Please select a workspace');
      return;
    }
    if (models.length === 0) {
      toast.error('No models available');
      return;
    }

    const requestMembers: ChannelMemberCreateRequest[] = members.map((member) => {
      const { modelId, agentKind, hasThinking, supportsPersona } = resolveMember(member, models);
      return {
        model_id: modelId,
        persona: supportsPersona && member.persona !== DEFAULT_PERSONA ? member.persona : null,
        thinking_mode: hasThinking
          ? coerceThinkingModeForAgent(member.thinkingMode, agentKind, modelId)
          : null,
      };
    });

    try {
      const channel = await createChannel.mutateAsync({
        workspace_id: workspaceId,
        name: trimmedName,
        members: requestMembers,
      });
      onClose();
      onCreated(channel.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create channel');
    }
  };

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      size="md"
      zIndex="modalHighest"
      className={styles.dialog}
    >
      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles['icon-box']}>
            <Hash className={styles['header-icon']} />
          </div>
          <div className={styles['header-text']}>
            <h2 className={styles.title}>New channel</h2>
            <p className={styles.subtitle}>A shared thread where several agents reply together.</p>
          </div>
        </div>

        <div className={styles.fields}>
          <div>
            <label className={styles['field-label']} htmlFor="channel-name">
              Name
            </label>
            <Input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="design-review"
              maxLength={255}
              autoFocus
            />
          </div>

          <div>
            <span className={styles['field-label']}>Workspace</span>
            <div className={styles['workspace-field']}>
              <WorkspaceSelector
                selectedWorkspaceId={workspaceId}
                onWorkspaceChange={setWorkspaceId}
                enabled={isAuthenticated}
              />
            </div>
          </div>

          <div>
            <span className={styles['field-label']}>Members</span>
            <div className={styles.members}>
              {members.map((member) => (
                <MemberRow
                  key={member.key}
                  member={member}
                  models={models}
                  personas={personas}
                  canRemove={members.length > 1}
                  onChange={(patch) => updateMember(member.key, patch)}
                  onRemove={() => setMembers((prev) => prev.filter((m) => m.key !== member.key))}
                />
              ))}
              <Button
                type="button"
                variant="unstyled"
                onClick={() => setMembers((prev) => [...prev, newMemberDraft()])}
                className={styles['add-member']}
              >
                <Plus className={styles['add-icon']} />
                Add member
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={createChannel.isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleCreate}
          disabled={createChannel.isPending || !workspaceId}
        >
          {createChannel.isPending ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </BaseModal>
  );
}
