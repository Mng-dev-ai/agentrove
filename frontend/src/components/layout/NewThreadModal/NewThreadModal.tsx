import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { composerSendStatus } from '@/components/chat/message-input/InputContext';
import { InputProvider } from '@/components/chat/message-input/InputProvider';
import { Textarea } from '@/components/chat/message-input/Textarea';
import { ComposerAttachmentSlots } from '@/components/chat/message-input/ComposerAttachmentSlots';
import { InputSuggestionsPanel } from '@/components/chat/message-input/InputSuggestionsPanel';
import { SendButton } from '@/components/chat/message-input/SendButton';
import { AttachButton } from '@/components/chat/message-input/AttachButton';
import { EnhanceButton } from '@/components/chat/message-input/EnhanceButton';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { WorkspaceSelector } from '@/components/chat/workspace-selector/WorkspaceSelector';
import { MachineWorkspaceSelector } from '@/components/chat/workspace-selector/MachineWorkspaceSelector';
import { RunLocationSelector } from '@/components/chat/run-location-selector/RunLocationSelector';
import { BranchWorktreeSelector } from '@/components/chat/worktree-selector/BranchWorktreeSelector';
import {
  groupMemberRequests,
  newGroupMember,
  type GroupMember,
  type SharedMemberSettings,
} from '@/components/channels/memberDraft';
import { ChatProvider } from '@/contexts/ChatContext';
import { stateClasses } from '@/config/stateClasses';
import { useInputContext } from '@/hooks/useInputContext';
import { useChatStore } from '@/store/chatStore';
import { useModelStore } from '@/store/modelStore';
import { useNewThreadStore } from '@/store/newThreadStore';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_WORKTREE,
  DEFAULT_FAST_MODE,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_THINKING_MODE,
  DEFAULT_PERSONA,
} from '@/store/chatSettingsStore';
import { useAuthStore } from '@/store/authStore';
import { machineName, machineStatus, useTargetMachineId } from '@/store/machineStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { PENDING_NEW_CHAT_KEY } from '@/types/ui.types';
import { chatService } from '@/services/chatService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useChatSettings } from '@/hooks/useChatSettings';
import { useCreateChatMutation } from '@/hooks/queries/useChatQueries';
import {
  useCreateChannelMutation,
  usePostChannelMessageMutation,
} from '@/hooks/queries/useChannelQueries';
import { useWorkspacesList, useWorkspaceResourcesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useFilesMetadataQuery, useGitBranchesQuery } from '@/hooks/queries/useSandboxQueries';
import { useModelSelection, useModelMap, useModelsQuery } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { buildAgentChatFields } from '@/utils/chatRequest';
import { buildFileStructureFromSandboxFiles } from '@/utils/file';
import { ThreadSettings } from './ThreadSettings';
import styles from './NewThreadModal.module.scss';

const DEFAULT_MEMBER_KEY = 'default-member';

// Base-branch intent is workspace-scoped, so switching workspace resets it.
const clearDefaultWorktreeBase = () =>
  useChatSettingsStore.getState().setWorktreeBaseBranch(DEFAULT_CHAT_SETTINGS_KEY, undefined);

function threadTitle(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').slice(0, 80);
}

export function NewThreadModal() {
  const isOpen = useNewThreadStore((state) => state.isOpen);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (!isOpen || !isAuthenticated) return null;
  return <NewThreadDialog />;
}

function NewThreadDialog() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const close = useNewThreadStore((state) => state.close);
  const message = useNewThreadStore((state) => state.message);
  const setMessage = useNewThreadStore((state) => state.setMessage);
  const storedMembers = useNewThreadStore((state) => state.members);
  const attachedFiles = useChatStore(
    (state) => state.attachedFilesByChat[PENDING_NEW_CHAT_KEY] ?? null,
  );
  const targetMachineId = useTargetMachineId();
  const isRemote = targetMachineId !== LOCAL_MACHINE_ID;
  const { selectedModelId, selectModel } = useModelSelection({ machineId: targetMachineId });
  const { data: models = [] } = useModelsQuery({ machineId: targetMachineId });
  const modelMap = useModelMap({ machineId: targetMachineId });
  const createChat = useCreateChatMutation();
  const createChannel = useCreateChannelMutation();
  const postChannelMessage = usePostChannelMessageMutation();
  const [isLoading, setIsLoading] = useState(false);

  const workspaces = useWorkspacesList();
  const [workspaceIdByMachine, setWorkspaceIdByMachine] = useState<Record<string, string>>(() => {
    const preselect = useNewThreadStore.getState().preselect;
    return preselect ? { [preselect.machineId]: preselect.workspaceId } : {};
  });
  const selectedWorkspaceId = workspaceIdByMachine[targetMachineId] ?? null;
  const localWorkspaceId = workspaceIdByMachine[LOCAL_MACHINE_ID] ?? null;

  // A preselected workspace lives on its machine, so the modal targets that machine
  useEffect(() => {
    const preselect = useNewThreadStore.getState().preselect;
    if (preselect) useChatSettingsStore.getState().setTargetMachine(preselect.machineId);
  }, []);

  // Clear the workspace-scoped default base only on a genuine switch (prior selection
  // existed and differs) so auto-select keeps a persisted base for the same workspace.
  const selectWorkspace = useCallback(
    (machineId: string, id: string) => {
      const previous = workspaceIdByMachine[machineId];
      if (previous === id) return;
      if (previous !== undefined) clearDefaultWorktreeBase();
      setWorkspaceIdByMachine((prev) => ({ ...prev, [machineId]: id }));
    },
    [workspaceIdByMachine],
  );
  const handleWorkspaceChange = useCallback(
    (id: string | null) => {
      if (id) selectWorkspace(targetMachineId, id);
    },
    [selectWorkspace, targetMachineId],
  );

  // Default local workspace when the list loads or the current pick is gone.
  useEffect(() => {
    if (!workspaces.length) return;
    if (localWorkspaceId && workspaces.some((ws) => ws.id === localWorkspaceId)) return;
    selectWorkspace(LOCAL_MACHINE_ID, workspaces[0].id);
  }, [workspaces, localWorkspaceId, selectWorkspace]);

  // Slash commands and personas are per-instance: the target machine's lists.
  const { data: workspaceResources } = useWorkspaceResourcesQuery(
    targetMachineId,
    selectedWorkspaceId ?? undefined,
  );
  const { data: settings } = useSettingsQuery({ machineId: targetMachineId });
  const personas = useMemo(() => settings?.personas ?? [], [settings?.personas]);

  const targetWorkspaces = useWorkspacesList({ machineId: targetMachineId });
  const sandboxId = targetWorkspaces.find((ws) => ws.id === selectedWorkspaceId)?.sandbox_id;
  const { data: filesMetadata = [] } = useFilesMetadataQuery(sandboxId, undefined, {
    enabled: !!sandboxId,
  });
  const fileStructure = useMemo(
    () => buildFileStructureFromSandboxFiles(filesMetadata),
    [filesMetadata],
  );
  const { data: branchesData } = useGitBranchesQuery(sandboxId, !!sandboxId);
  const storedBase = useChatSettingsStore(
    (state) => state.worktreeBaseBranchByChat[DEFAULT_CHAT_SETTINGS_KEY],
  );
  const worktree = useChatSettingsStore(
    (state) => state.worktreeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_WORKTREE,
  );

  // Members belong to the machine whose models they name; elsewhere the default model leads.
  const members = useMemo<GroupMember[]>(() => {
    if (storedMembers?.machineId === targetMachineId) return storedMembers.list;
    return selectedModelId
      ? [{ key: DEFAULT_MEMBER_KEY, modelId: selectedModelId, customName: null, overrides: {} }]
      : [];
  }, [storedMembers, targetMachineId, selectedModelId]);
  const isGroup = members.length > 1;
  const { thinkingMode, persona, permissionMode } = useChatSettings(undefined);
  const shared = useMemo<SharedMemberSettings>(
    () => ({ thinkingMode, persona, permissionMode }),
    [thinkingMode, persona, permissionMode],
  );
  const setMembers = useCallback(
    (list: GroupMember[]) => {
      useNewThreadStore.getState().setMembers({ machineId: targetMachineId, list });
      // One member is the chat flow, whose model is the persisted default
      if (list.length === 1) selectModel(list[0].modelId);
    },
    [targetMachineId, selectModel],
  );

  const handleFileAttach = useCallback((action: SetStateAction<File[]>) => {
    const store = useChatStore.getState();
    const files =
      typeof action === 'function'
        ? action(store.attachedFilesByChat[PENDING_NEW_CHAT_KEY] ?? [])
        : action;
    store.setAttachedFilesForChat(PENDING_NEW_CHAT_KEY, files);
  }, []);

  // A submission in flight keeps the modal open until it navigates
  const requestClose = () => {
    if (!isLoading) close();
  };

  const clearDraft = () => {
    useNewThreadStore.getState().clearDraft();
    useChatStore.getState().setAttachedFilesForChat(PENDING_NEW_CHAT_KEY, []);
  };

  const createChatThread = async (prompt: string, modelId: string, workspaceId: string) => {
    const title = threadTitle(prompt) || 'New Chat';
    if (isRemote) {
      const chatSettings = useChatSettingsStore.getState();
      const newChat = await chatService.createChat(targetMachineId, {
        title,
        model_id: modelId,
        workspace_id: workspaceId,
      });
      // Same toolbar default coercion as useMessageActions (remote matches local).
      await chatService.startCompletion({
        prompt,
        chat_id: newChat.id,
        model_id: modelId,
        attached_files: attachedFiles ?? undefined,
        ...buildAgentChatFields(
          modelId,
          modelMap,
          {
            permissionMode:
              chatSettings.permissionModeByChat[DEFAULT_CHAT_SETTINGS_KEY] ??
              DEFAULT_PERMISSION_MODE,
            thinkingMode:
              chatSettings.thinkingModeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_THINKING_MODE,
            worktree: chatSettings.worktreeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_WORKTREE,
            baseBranch: chatSettings.worktreeBaseBranchByChat[DEFAULT_CHAT_SETTINGS_KEY],
            fastMode: chatSettings.fastModeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_FAST_MODE,
            persona: chatSettings.personaByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_PERSONA,
          },
          personas,
        ),
      });
      clearDraft();
      // Invalidate so sidebar lists re-sort by last_chat_at.
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.machine.chats(targetMachineId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.machine.workspaces(targetMachineId) }),
      ]).catch((err) => console.error('Failed to refresh sidebar after new chat', err));
      useModelStore.getState().selectModel(newChat.id, modelId);
      useChatSettingsStore.getState().initChatFromDefaults(newChat.id);
      close();
      // Completion already started — navigate without initialPrompt (no second turn).
      navigate(`/chat/${newChat.id}`);
      return;
    }

    const newChat = await createChat.mutateAsync({
      title,
      model_id: modelId,
      workspace_id: workspaceId,
    });
    useModelStore.getState().selectModel(newChat.id, modelId);
    useChatSettingsStore.getState().initChatFromDefaults(newChat.id);
    useNewThreadStore.getState().clearDraft();
    useChatStore.getState().promoteAttachedFiles(PENDING_NEW_CHAT_KEY, newChat.id);
    close();
    navigate(`/chat/${newChat.id}`, { state: { initialPrompt: prompt } });
  };

  const createGroupThread = async (prompt: string, workspaceId: string) => {
    const { requests, names } = groupMemberRequests(members, shared, models, personas);
    const invalidName = names.find((name) => name.error);
    if (invalidName) {
      toast.error(`${invalidName.name}: ${invalidName.error}`);
      return;
    }
    const hasBranches = !!branchesData?.is_git_repo && branchesData.branches.length > 0;
    const base =
      storedBase && branchesData?.branches.includes(storedBase)
        ? storedBase
        : branchesData?.current_branch;
    const channel = await createChannel.mutateAsync({
      machineId: targetMachineId,
      data: {
        workspace_id: workspaceId,
        name: threadTitle(prompt),
        worktree,
        branch: hasBranches ? ((worktree ? base : branchesData.current_branch) ?? null) : null,
        members: requests,
      },
    });
    try {
      await postChannelMessage.mutateAsync({
        channelId: channel.id,
        content: prompt,
        files: attachedFiles ?? [],
      });
      clearDraft();
      close();
      navigate(`/channels/${channel.id}`);
    } catch (error) {
      toast.error(
        `Channel created, but the first message failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      clearDraft();
      close();
      navigate(`/channels/${channel.id}`, { state: { initialDraft: prompt } });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = message.trim();
    if (!prompt || isLoading) return;
    if (isRemote && machineStatus(targetMachineId) !== 'online') {
      toast.error(`${machineName(targetMachineId)} is not connected`);
      return;
    }
    const firstModelId = members[0]?.modelId;
    if (!firstModelId?.trim()) {
      toast.error('Please select an AI model');
      return;
    }
    if (!selectedWorkspaceId) {
      toast.error('Please select a workspace');
      return;
    }
    setIsLoading(true);
    try {
      if (isGroup) await createGroupThread(prompt, selectedWorkspaceId);
      else await createChatThread(prompt, firstModelId, selectedWorkspaceId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isGroup
            ? 'Failed to create channel'
            : 'Failed to create chat',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <BaseModal
      isOpen
      onClose={requestClose}
      size="full"
      className={styles.dialog}
      ariaLabel="New thread"
    >
      <ChatProvider
        sandboxId={sandboxId}
        fileStructure={fileStructure}
        builtinSlashCommands={workspaceResources?.builtin_slash_commands}
        personas={personas}
      >
        <InputProvider
          message={message}
          setMessage={setMessage}
          onSubmit={handleSubmit}
          onAttach={handleFileAttach}
          attachedFiles={attachedFiles}
          isLoading={isLoading}
          showLoadingSpinner
          placeholder="Write prompt…"
          selectedModelId={members[0]?.modelId ?? ''}
          onModelChange={selectModel}
          machineId={targetMachineId}
        >
          <NewThreadComposer onClose={requestClose}>
            <RunLocationSelector disabled={isLoading} />
            {isRemote ? (
              <MachineWorkspaceSelector
                machineId={targetMachineId}
                selectedWorkspaceId={selectedWorkspaceId}
                onWorkspaceChange={handleWorkspaceChange}
                disabled={isLoading}
              />
            ) : (
              <WorkspaceSelector
                selectedWorkspaceId={selectedWorkspaceId}
                onWorkspaceChange={handleWorkspaceChange}
                enabled
              />
            )}
            <BranchWorktreeSelector disabled={isLoading} />
            <ModelSelector
              selectedModelId={members[0]?.modelId ?? ''}
              onModelChange={(modelId) => setMembers([newGroupMember(modelId)])}
              dropdownPosition="auto"
              disabled={isLoading}
              compact={false}
              variant="pill"
              machineId={targetMachineId}
              agents={{
                modelIds: members.map((member) => member.modelId),
                onAdd: (modelId) => setMembers([...members, newGroupMember(modelId)]),
                onRemove: (modelId) => {
                  const index = members.map((member) => member.modelId).lastIndexOf(modelId);
                  if (members.length > 1) setMembers(members.filter((_, i) => i !== index));
                },
              }}
            />
            <ThreadSettings
              machineId={targetMachineId}
              members={members}
              shared={shared}
              personas={personas}
              disabled={isLoading}
              onChange={setMembers}
            />
          </NewThreadComposer>
        </InputProvider>
      </ChatProvider>
    </BaseModal>
  );
}

// The modal is the composer: prompt and attachments on top, every control in one footer row.
function NewThreadComposer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { state, actions, meta } = useInputContext();
  const sendStatus = composerSendStatus(state);
  return (
    <form ref={meta.formRef} onSubmit={actions.handleSubmit} className={styles.form}>
      <div className={styles.top}>
        <Button type="button" variant="unstyled" onClick={onClose} className={styles.close}>
          <X className={styles['close-icon']} />
          Close
        </Button>
      </div>
      <div
        {...meta.dragHandlers}
        className={clsx(styles.body, state.isDragging && stateClasses.DRAGGING)}
      >
        <Textarea
          ref={meta.textareaRef}
          size="large"
          message={state.message}
          setMessage={actions.setMessage}
          placeholder={state.placeholders[0]}
          isLoading={state.isLoading}
          disabled={state.isDisabled}
          onKeyDown={actions.handleKeyDown}
          onPaste={actions.handlePaste}
          onCursorPositionChange={actions.setCursorPosition}
        />
        <ComposerAttachmentSlots
          machineId={state.machineId}
          isDragging={state.isDragging}
          files={state.showPreview && state.attachedFiles ? state.attachedFiles : []}
          previewUrls={state.previewUrls}
          onRemoveFile={actions.handleRemoveFile}
          onEditImage={actions.handleDrawClick}
          showFileUpload={state.showFileUpload}
          onCloseFileUpload={() => actions.setShowFileUpload(false)}
          onFileSelect={actions.handleFileSelect}
          editingImageIndex={state.editingImageIndex}
          showDrawingModal={state.showDrawingModal}
          onCloseDrawing={actions.closeDrawingModal}
          onSaveDrawing={actions.handleDrawingSave}
        />
        <div className={styles.attach}>
          <AttachButton
            disabled={state.isDisabled}
            onAttach={() => {
              actions.resetDragState();
              actions.setShowFileUpload(true);
            }}
          />
        </div>
      </div>
      <div className={styles.footer}>
        <div className={styles.suggestions}>
          <InputSuggestionsPanel />
        </div>
        <div className={styles.pills}>{children}</div>
        {state.hasMessage && (
          <EnhanceButton
            onEnhance={actions.handleEnhancePrompt}
            isEnhancing={state.isEnhancing}
            disabled={state.isLoading}
          />
        )}
        <SendButton
          status={sendStatus}
          disabled={sendStatus === 'idle' || state.isEnhancing || state.isDisabled}
          onClick={actions.handleSendClick}
          showLoadingSpinner={state.showLoadingSpinner}
        />
      </div>
    </form>
  );
}
