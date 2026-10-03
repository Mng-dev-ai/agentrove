import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Hash, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Select } from '@/components/ui/primitives/Select/Select';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import {
  coerceThinkingModeForAgent,
  getThinkingModesForAgent,
} from '@/components/chat/thinking-mode-selector/thinkingModes';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { useCreateChannelMutation } from '@/hooks/queries/useChannelQueries';
import { DEFAULT_PERSONA, DEFAULT_THINKING_MODE } from '@/store/chatSettingsStore';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import type { Model } from '@/types/chat.types';
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

interface MemberRowProps {
  member: MemberDraft;
  models: Model[];
  personas: string[];
  canRemove: boolean;
  onChange: (patch: Partial<MemberDraft>) => void;
  onRemove: () => void;
}

function MemberRow({ member, models, personas, canRemove, onChange, onRemove }: MemberRowProps) {
  const modelId = member.modelId || models[0]?.model_id || '';
  const agentKind = models.find((m) => m.model_id === modelId)?.agent_kind ?? 'claude';
  const thinkingModes = getThinkingModesForAgent(agentKind, modelId);
  const effectiveMode = coerceThinkingModeForAgent(member.thinkingMode, agentKind, modelId);
  const selectedThinking = thinkingModes.find((mode) => mode.value === effectiveMode);

  return (
    <div className={styles['member-row']}>
      <div className={styles['member-controls']}>
        <ModelSelector
          selectedModelId={modelId}
          onModelChange={(next) => onChange({ modelId: next })}
          dropdownPosition="bottom"
          compact={false}
        />
        <Select
          value={member.persona}
          onChange={(e) => onChange({ persona: e.target.value })}
          className={styles['persona-select']}
          aria-label="Persona"
        >
          <option value={DEFAULT_PERSONA}>Default</option>
          {personas.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        {selectedThinking && (
          <Dropdown
            value={selectedThinking}
            items={thinkingModes}
            getItemKey={(mode) => mode.value}
            getItemLabel={(mode) => mode.label}
            onSelect={(mode) => onChange({ thinkingMode: mode.value })}
            leftIcon={Brain}
            dropdownPosition="bottom"
          />
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="Remove member"
      >
        <X className={styles['remove-icon']} />
      </Button>
    </div>
  );
}

interface CreateChannelDialogProps {
  workspaceId: string;
  onClose: () => void;
}

export function CreateChannelDialog({ workspaceId, onClose }: CreateChannelDialogProps) {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: models = [] } = useModelsQuery({ enabled: isAuthenticated });
  const { data: settings } = useSettingsQuery({ enabled: isAuthenticated });
  const personaNames = (settings?.personas ?? []).map((persona) => persona.name);

  const [name, setName] = useState('');
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
    if (models.length === 0) {
      toast.error('No models available');
      return;
    }

    const requestMembers: ChannelMemberCreateRequest[] = members.map((member) => {
      const modelId = member.modelId || models[0].model_id;
      const agentKind = models.find((m) => m.model_id === modelId)?.agent_kind ?? 'claude';
      const hasThinking = getThinkingModesForAgent(agentKind, modelId).length > 0;
      return {
        model_id: modelId,
        persona: member.persona === DEFAULT_PERSONA ? null : member.persona,
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
      navigate(`/channels/${channel.id}`);
      if (window.innerWidth < 640) useUIStore.getState().setSidebarOpen(false);
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
          <h2 className={styles.title}>New channel</h2>
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
            <label className={styles['field-label']}>Members</label>
            <div className={styles.members}>
              {members.map((member) => (
                <MemberRow
                  key={member.key}
                  member={member}
                  models={models}
                  personas={personaNames}
                  canRemove={members.length > 1}
                  onChange={(patch) => updateMember(member.key, patch)}
                  onRemove={() => setMembers((prev) => prev.filter((m) => m.key !== member.key))}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMembers((prev) => [...prev, newMemberDraft()])}
              className={styles['add-member']}
            >
              <Plus className={styles['add-icon']} />
              Add member
            </Button>
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
          disabled={createChannel.isPending}
        >
          {createChannel.isPending ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </BaseModal>
  );
}
