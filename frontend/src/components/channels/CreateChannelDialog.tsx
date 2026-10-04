import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import clsx from 'clsx';
import { ChevronDown, Hash, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeDropdown } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { PersonaDropdown } from '@/components/chat/persona-selector/PersonaSelector';
import { PermissionModeDropdown } from '@/components/chat/permission-mode-selector/PermissionModeSelector';
import { coercePermissionModeForAgent } from '@/components/chat/permission-mode-selector/permissionModes';
import { PERSONAS_SUPPORTED_AGENTS } from '@/components/chat/persona-selector/personaSupport';
import { WorkspaceSelector } from '@/components/chat/workspace-selector/WorkspaceSelector';
import { BranchWorktreeDropdown } from '@/components/chat/worktree-selector/BranchWorktreeSelector';
import {
  coerceThinkingModeForAgent,
  getThinkingModesForAgent,
} from '@/components/chat/thinking-mode-selector/thinkingModes';
import { useDropdown } from '@/hooks/useDropdown';
import { usePanelFit } from '@/hooks/usePanelFit';
import { useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { useGitBranchesQuery } from '@/hooks/queries/useSandboxQueries';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useCreateChannelMutation } from '@/hooks/queries/useChannelQueries';
import {
  DEFAULT_PERMISSION_MODE,
  DEFAULT_PERSONA,
  DEFAULT_THINKING_MODE,
  DEFAULT_WORKTREE,
  type PermissionMode,
} from '@/store/chatSettingsStore';
import { useAuthStore } from '@/store/authStore';
import { stateClasses } from '@/config/stateClasses';
import type { Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import type { ChannelMemberCreateRequest } from '@/types/channel.types';
import styles from './CreateChannelDialog.module.scss';

interface MemberDraft {
  key: string;
  modelId: string;
  persona: string;
  thinkingMode: string;
  permissionMode: PermissionMode;
}

function newMemberDraft(): MemberDraft {
  return {
    key: crypto.randomUUID(),
    modelId: '',
    persona: DEFAULT_PERSONA,
    thinkingMode: DEFAULT_THINKING_MODE,
    permissionMode: DEFAULT_PERMISSION_MODE,
  };
}

function resolveMember(member: MemberDraft, models: Model[]) {
  const modelId = member.modelId || models[0]?.model_id || '';
  const model = models.find((m) => m.model_id === modelId);
  const agentKind = model?.agent_kind ?? 'claude';
  return {
    modelId,
    modelName: model?.name ?? modelId,
    agentKind,
    hasThinking: getThinkingModesForAgent(agentKind, modelId).length > 0,
    supportsPersona: PERSONAS_SUPPORTED_AGENTS.has(agentKind),
  };
}

function memberDisplayNames(members: MemberDraft[], models: Model[]): string[] {
  const counts = new Map<string, number>();
  return members.map((member) => {
    const name = resolveMember(member, models).agentKind.toLowerCase();
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    return count === 1 ? name : `${name}-${count}`;
  });
}

function useContentOverflows(
  scrollerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
): boolean {
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const measure = () => setOverflows(content.offsetHeight > scroller.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollerRef, contentRef]);

  return overflows;
}

interface MemberChipProps {
  member: MemberDraft;
  displayName: string;
  models: Model[];
  personas: Persona[];
  canRemove: boolean;
  onChange: (patch: Partial<MemberDraft>) => void;
  onRemove: () => void;
}

function MemberChip({
  member,
  displayName,
  models,
  personas,
  canRemove,
  onChange,
  onRemove,
}: MemberChipProps) {
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const popoverRef = useRef<HTMLDivElement>(null);
  const fit = usePanelFit(dropdownRef, popoverRef, isOpen);
  const { modelId, modelName, agentKind, hasThinking, supportsPersona } = resolveMember(
    member,
    models,
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, setIsOpen]);

  return (
    <div ref={dropdownRef} className={styles['chip-wrap']}>
      <FloatingTooltip content={isOpen ? '' : modelName}>
        <Button
          type="button"
          variant="unstyled"
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          className={clsx(styles.chip, isOpen && stateClasses.OPEN)}
        >
          <ProviderIcon agentKind={agentKind} className={styles['chip-icon']} />
          <span className={styles['chip-label']}>{displayName}</span>
          <ChevronDown className={styles['chip-caret']} />
        </Button>
      </FloatingTooltip>

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${displayName} settings`}
          style={{ maxHeight: fit?.maxHeight }}
          className={clsx(
            styles.popover,
            fit?.side === 'top' && styles['popover--top'],
            fit?.maxHeight !== undefined && styles['popover--capped'],
          )}
        >
          <div className={styles['popover-row']}>
            <span className={styles['popover-label']}>Model</span>
            <ModelSelector
              selectedModelId={modelId}
              onModelChange={(next) => onChange({ modelId: next })}
              dropdownPosition="auto"
              dropdownAlign="right"
              variant="text"
            />
          </div>
          {hasThinking && (
            <div className={styles['popover-row']}>
              <span className={styles['popover-label']}>Thinking</span>
              <ThinkingModeDropdown
                value={member.thinkingMode}
                onChange={(thinkingMode) => onChange({ thinkingMode })}
                agentKind={agentKind}
                modelId={modelId}
                dropdownPosition="auto"
                dropdownAlign="right"
                variant="text"
              />
            </div>
          )}
          {supportsPersona && personas.length > 0 && (
            <div className={styles['popover-row']}>
              <span className={styles['popover-label']}>Persona</span>
              <PersonaDropdown
                personas={personas}
                value={member.persona}
                onChange={(persona) => onChange({ persona })}
                dropdownPosition="auto"
                dropdownAlign="right"
                variant="text"
              />
            </div>
          )}
          <div className={styles['popover-row']}>
            <span className={styles['popover-label']}>Permission</span>
            <PermissionModeDropdown
              value={member.permissionMode}
              onChange={(permissionMode) => onChange({ permissionMode })}
              agentKind={agentKind}
              dropdownPosition="auto"
              dropdownAlign="right"
              variant="text"
            />
          </div>
          {canRemove && (
            <>
              <div role="separator" className={styles['popover-divider']} />
              <Button
                type="button"
                variant="unstyled"
                onClick={onRemove}
                className={styles['popover-remove']}
              >
                <Trash2 className={styles['popover-remove-icon']} />
                Remove member
              </Button>
            </>
          )}
        </div>
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
  const workspaces = useWorkspacesList({ enabled: isAuthenticated });

  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId);
  const [worktree, setWorktree] = useState(DEFAULT_WORKTREE);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberDraft[]>(() => [newMemberDraft()]);
  const createChannel = useCreateChannelMutation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyContentRef = useRef<HTMLDivElement>(null);
  const bodyOverflows = useContentOverflows(bodyRef, bodyContentRef);

  const sandboxId = workspaces.find((workspace) => workspace.id === workspaceId)?.sandbox_id;
  const { data: branchesData } = useGitBranchesQuery(sandboxId, !!sandboxId);
  const hasBranches = !!branchesData?.is_git_repo && branchesData.branches.length > 0;
  const branch = hasBranches ? (selectedBranch ?? branchesData.current_branch) : null;

  const handleWorkspaceChange = (nextWorkspaceId: string | null) => {
    setWorkspaceId(nextWorkspaceId);
    setSelectedBranch(null);
  };

  const displayNames = memberDisplayNames(members, models);

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
        permission_mode: coercePermissionModeForAgent(member.permissionMode, agentKind),
      };
    });

    try {
      const channel = await createChannel.mutateAsync({
        workspace_id: workspaceId,
        name: trimmedName,
        worktree,
        branch,
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
      <div ref={bodyRef} className={clsx(styles.body, bodyOverflows && styles['body--scroll'])}>
        <div ref={bodyContentRef} className={styles['body-content']}>
          <div className={styles.header}>
            <div className={styles['icon-box']}>
              <Hash className={styles['header-icon']} />
            </div>
            <div className={styles['header-text']}>
              <h2 className={styles.title}>New channel</h2>
              <p className={styles.subtitle}>
                A shared thread where several agents reply together.
              </p>
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
                  onWorkspaceChange={handleWorkspaceChange}
                  enabled={isAuthenticated}
                />
              </div>
            </div>

            <div>
              <span className={styles['field-label']}>Branch</span>
              <div className={styles['branch-field']}>
                <BranchWorktreeDropdown
                  branchesData={sandboxId ? branchesData : undefined}
                  worktree={worktree}
                  onWorktreeChange={setWorktree}
                  branch={branch ?? ''}
                  onBranchChange={setSelectedBranch}
                  dropdownPosition="auto"
                />
              </div>
            </div>

            <div>
              <span className={styles['field-label']}>Members</span>
              <div className={styles.members}>
                {members.map((member, index) => (
                  <MemberChip
                    key={member.key}
                    member={member}
                    displayName={displayNames[index]}
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
                  className={styles['add-chip']}
                  aria-label="Add member"
                >
                  <Plus className={styles['add-icon']} />
                </Button>
              </div>
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
