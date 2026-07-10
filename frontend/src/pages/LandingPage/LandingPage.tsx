import { useState, useRef, useMemo, useCallback, useEffect, ReactNode, Suspense } from 'react';
import { lazyNamed } from '@/utils/lazyNamed';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import { Input as ChatInput } from '@/components/chat/message-input/Input';
import { WorkspaceSelector } from '@/components/chat/workspace-selector/WorkspaceSelector';
import { RunLocationSelector } from '@/components/chat/run-location-selector/RunLocationSelector';
import { WorktreeToggle } from '@/components/chat/worktree-selector/WorktreeToggle';
import { CloudWorkspaceSelector } from '@/components/chat/workspace-selector/CloudWorkspaceSelector';
import {
  useCloudWorkspacesQuery,
  useCloudWorkspaceResourcesQuery,
  useCloudSettingsQuery,
} from '@/hooks/queries/useCloudQueries';
import { useChatStore } from '@/store/chatStore';
import { useUIStore } from '@/store/uiStore';
import { useModelStore } from '@/store/modelStore';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_WORKTREE,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_THINKING_MODE,
  DEFAULT_PERSONA,
} from '@/store/chatSettingsStore';
import { useQueryClient } from '@tanstack/react-query';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { cloudChatService } from '@/services/cloudChatService';
import { markCloudChats } from '@/utils/chatOrigin';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { useCreateChatMutation } from '@/hooks/queries/useChatQueries';
import { useWorkspacesList, useWorkspaceResourcesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useFilesMetadataQuery } from '@/hooks/queries/useSandboxQueries';
import { useModelSelection, useModelMap } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { buildAgentChatFields } from '@/utils/chatRequest';
import { ChatProvider } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/primitives/Button/Button';
import { buildFileStructureFromSandboxFiles } from '@/utils/file';
import { SplitViewContainer } from '@/components/ui/SplitViewContainer/SplitViewContainer';
import { CommandMenu } from '@/components/ui/command-menu/CommandMenu';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { useEditorState } from '@/hooks/useEditorState';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback/ViewLoadingFallback';
import { PENDING_NEW_CHAT_KEY, type TileId } from '@/types/ui.types';
import { tileIdToViewType } from '@/utils/tileHelpers';
import styles from './LandingPage.module.scss';

const Editor = lazyNamed(() => import('@/components/editor/editor-core/Editor'), 'Editor');
const SecretsView = lazyNamed(
  () => import('@/components/sandbox/secrets/SecretsView/SecretsView'),
  'SecretsView',
);
const DiffView = lazyNamed(() => import('@/components/sandbox/git/DiffView/DiffView'), 'DiffView');
const TerminalContainer = lazyNamed(
  () => import('@/components/sandbox/terminal/Container/Container'),
  'Container',
);

const EXAMPLE_PROMPTS = [
  'Build a REST API with authentication',
  'Find and fix bugs in my codebase',
  'Refactor this project to use TypeScript',
];

export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  useCommandMenu();
  const attachedFiles = useChatStore(
    (state) => state.attachedFilesByChat[PENDING_NEW_CHAT_KEY] ?? null,
  );
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { selectedModelId, selectModel } = useModelSelection({
    enabled: isAuthenticated,
  });

  const workspaces = useWorkspacesList({ enabled: isAuthenticated });
  const modelMap = useModelMap(isAuthenticated);

  const createChat = useCreateChatMutation();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const consumedInitialMessageRef = useRef(false);
  const routeState = location.state as {
    workspaceId?: string;
    cloudWorkspaceId?: string;
    initialMessage?: string;
  } | null;
  const initialWorkspaceId = routeState?.workspaceId ?? null;
  const initialCloudWorkspaceId = routeState?.cloudWorkspaceId ?? null;
  const initialMessage = routeState?.initialMessage ?? null;
  // Keyed on location.key, not the target ID: React Router mints a fresh key on
  // every navigation, so re-clicking the same workspace's "new thread" re-consumes
  // the target and re-applies its run location even after a manual toggle.
  const consumedNavKeyRef = useRef<string | null>(null);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const isCloud = useChatSettingsStore((state) => state.runOnCloud);
  const [selectedCloudWorkspaceId, setSelectedCloudWorkspaceId] = useState<string | null>(null);

  // Default the local workspace once the list loads or the current pick goes stale.
  useEffect(() => {
    if (!workspaces.length) return;
    if (selectedWorkspaceId && workspaces.some((ws) => ws.id === selectedWorkspaceId)) return;
    setSelectedWorkspaceId(workspaces[0].id);
  }, [workspaces, selectedWorkspaceId]);

  // Consume the sidebar "new thread" target once per navigation: preselect its
  // workspace and flip the run location to match (cloud target → cloud, local →
  // local). Keyed on location.key so re-clicking the same workspace re-applies it.
  useEffect(() => {
    if (location.key === consumedNavKeyRef.current) return;
    consumedNavKeyRef.current = location.key;
    if (initialCloudWorkspaceId) {
      setSelectedCloudWorkspaceId(initialCloudWorkspaceId);
      useChatSettingsStore.getState().setRunOnCloud(true);
    } else if (initialWorkspaceId) {
      setSelectedWorkspaceId(initialWorkspaceId);
      useChatSettingsStore.getState().setRunOnCloud(false);
    }
  }, [location.key, initialWorkspaceId, initialCloudWorkspaceId]);

  if (initialMessage && !consumedInitialMessageRef.current) {
    consumedInitialMessageRef.current = true;
    setMessage(initialMessage);
  }

  // Skills and slash-commands are per-instance. Local runs fetch from the local
  // backend; cloud runs fetch from the VPS so its skills/commands appear in the
  // landing composer before a chat exists.
  const { data: workspaceResources } = useWorkspaceResourcesQuery(
    selectedWorkspaceId ?? undefined,
    undefined,
    {
      enabled: isAuthenticated && !!selectedWorkspaceId && !isCloud,
    },
  );
  const { data: cloudWorkspaceResources } = useCloudWorkspaceResourcesQuery(
    selectedCloudWorkspaceId ?? undefined,
    isAuthenticated && isCloud,
  );
  const resolvedWorkspaceResources = isCloud ? cloudWorkspaceResources : workspaceResources;

  // Personas are per-instance — fetch from the VPS for cloud runs so the
  // persona selector shows the VPS's personas and chat creation resolves the
  // selected persona against the VPS's list.
  const { data: settings } = useSettingsQuery({ enabled: isAuthenticated });
  const { data: cloudSettings } = useCloudSettingsQuery(isAuthenticated && isCloud);
  const resolvedPersonas = isCloud ? cloudSettings?.personas : settings?.personas;

  // Resolve the sandbox for both local and cloud so the editor, @file mentions,
  // and branch selector route to the backend that owns the workspace.
  const { data: cloudWorkspaces } = useCloudWorkspacesQuery(isAuthenticated && isCloud);
  const selectedSandboxId = isCloud
    ? cloudWorkspaces?.find((ws) => ws.id === selectedCloudWorkspaceId)?.sandbox_id
    : workspaces.find((ws) => ws.id === selectedWorkspaceId)?.sandbox_id;

  const {
    data: filesMetadata = [],
    isLoading: isFilesMetadataLoading,
    refetch: refetchFilesMetadata,
  } = useFilesMetadataQuery(selectedSandboxId, undefined, {
    enabled: isAuthenticated && !!selectedSandboxId,
  });

  const fileStructure = useMemo(
    () => buildFileStructureFromSandboxFiles(filesMetadata),
    [filesMetadata],
  );

  const { selectedFile, setSelectedFile, isRefreshing, handleRefresh, openFiles, closeFile } =
    useEditorState(refetchFilesMetadata, undefined, fileStructure);

  // The landing editor's selection/tabs live under a shared store key (not component
  // state), so reset them when the chosen sandbox changes and on mount — otherwise a
  // prior session's tabs would linger. An effect (not a render-phase store write) keeps
  // the external-store mutation off the render path.
  useEffect(() => {
    setSelectedFile(null);
  }, [selectedSandboxId, setSelectedFile]);

  // Publish the selected workspace's sandbox so the context-less global git
  // shortcuts resolve a target on landing; clear it on unmount so it can't leak
  // into a later chat with no sandbox of its own.
  useEffect(() => {
    useUIStore.getState().setWorkspaceSandboxId(selectedSandboxId ?? null);
    return () => useUIStore.getState().setWorkspaceSandboxId(null);
  }, [selectedSandboxId]);

  useMountEffect(() => {
    useChatStore.getState().setCurrentChat(null);
    // Reset to the agent (workspace selector) view — a stale split layout from a prior chat
    // would otherwise persist into the landing screen.
    useUIStore.getState().resetWorkspace();
  });

  const handleFileAttach = useCallback((files: File[]) => {
    useChatStore.getState().setAttachedFilesForChat(PENDING_NEW_CHAT_KEY, files);
  }, []);

  const handleNewChat = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedPrompt = message.trim();
      if (!trimmedPrompt || isLoading) return;

      if (!isAuthenticated) {
        navigate('/signup');
        return;
      }

      if (!selectedModelId?.trim()) {
        toast.error('Please select an AI model');
        return;
      }

      const title = trimmedPrompt.replace(/\s+/g, ' ').slice(0, 80) || 'New Chat';

      if (isCloud) {
        if (!useCloudSettingsStore.getState().connectedEmail) {
          toast.error('Connect a cloud instance in Settings first');
          return;
        }
        if (!selectedCloudWorkspaceId) {
          toast.error('Please select a cloud workspace');
          return;
        }

        setIsLoading(true);
        try {
          const chatSettings = useChatSettingsStore.getState();
          const newChat = await cloudChatService.createChat({
            title,
            model_id: selectedModelId,
            workspace_id: selectedCloudWorkspaceId,
          });
          // Coerce toolbar defaults like useMessageActions so cloud matches local.
          await cloudChatService.startCompletion({
            prompt: trimmedPrompt,
            chat_id: newChat.id,
            model_id: selectedModelId,
            attached_files: attachedFiles ?? undefined,
            ...buildAgentChatFields(
              selectedModelId,
              modelMap,
              {
                permissionMode:
                  chatSettings.permissionModeByChat[DEFAULT_CHAT_SETTINGS_KEY] ??
                  DEFAULT_PERMISSION_MODE,
                thinkingMode:
                  chatSettings.thinkingModeByChat[DEFAULT_CHAT_SETTINGS_KEY] ??
                  DEFAULT_THINKING_MODE,
                worktree:
                  chatSettings.worktreeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_WORKTREE,
                persona: chatSettings.personaByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_PERSONA,
              },
              resolvedPersonas ?? [],
            ),
          });

          setMessage('');
          useChatStore.getState().setAttachedFilesForChat(PENDING_NEW_CHAT_KEY, []);

          // Register the chat as cloud-owned and refresh the sidebar's cloud chats
          // and workspaces so the new chat appears and its project re-sorts to the
          // top by last_chat_at — the merged sidebar list orders local + cloud together.
          markCloudChats([newChat.id]);
          const cloud = useCloudSettingsStore.getState();
          void Promise.all([
            queryClient.invalidateQueries({
              queryKey: queryKeys.cloudChats(cloud.cloudUrl, cloud.connectedEmail),
            }),
            queryClient.invalidateQueries({
              queryKey: queryKeys.cloudWorkspaces(cloud.cloudUrl, cloud.connectedEmail),
            }),
          ]).catch((err) => console.error('Failed to refresh cloud sidebar after new chat', err));

          useModelStore.getState().selectModel(newChat.id, selectedModelId);
          useChatSettingsStore.getState().initChatFromDefaults(newChat.id);
          // Run is already started on the VPS — open the chat without an
          // initialPrompt so the page reconnects to the live stream instead of
          // firing a second turn.
          navigate(`/chat/${newChat.id}`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Failed to start cloud chat');
        } finally {
          setIsLoading(false);
        }
        return;
      }

      if (!selectedWorkspaceId) {
        toast.error('Please select a workspace');
        return;
      }

      setIsLoading(true);
      try {
        const newChat = await createChat.mutateAsync({
          title,
          model_id: selectedModelId,
          workspace_id: selectedWorkspaceId,
        });
        useModelStore.getState().selectModel(newChat.id, selectedModelId);
        useChatSettingsStore.getState().initChatFromDefaults(newChat.id);
        setMessage('');
        useChatStore.getState().promoteAttachedFiles(PENDING_NEW_CHAT_KEY, newChat.id);
        navigate(`/chat/${newChat.id}`, { state: { initialPrompt: trimmedPrompt } });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to create chat');
      } finally {
        setIsLoading(false);
      }
    },
    [
      createChat,
      isAuthenticated,
      isLoading,
      message,
      navigate,
      selectedModelId,
      selectedWorkspaceId,
      isCloud,
      selectedCloudWorkspaceId,
      attachedFiles,
      modelMap,
      resolvedPersonas,
    ],
  );

  const handleChatSelect = useCallback(
    (chatId: string) => {
      navigate(`/chat/${chatId}`);
    },
    [navigate],
  );

  const sidebarContent = useMemo(() => {
    if (!isAuthenticated) return null;

    return (
      <Sidebar workspaces={workspaces} selectedChatId={null} onChatSelect={handleChatSelect} />
    );
  }, [workspaces, handleChatSelect, isAuthenticated]);

  useLayoutSidebar(sidebarContent);

  const renderView = useCallback(
    (tileId: TileId, isVisible: boolean): ReactNode => {
      switch (tileIdToViewType(tileId)) {
        case 'agent':
          return (
            <div className={styles['agent-view']}>
              <div className={styles['agent-panel']}>
                <div className={styles['selector-row']}>
                  {isCloud ? (
                    <CloudWorkspaceSelector
                      selectedWorkspaceId={selectedCloudWorkspaceId}
                      onWorkspaceChange={setSelectedCloudWorkspaceId}
                      disabled={isLoading}
                    />
                  ) : (
                    <WorkspaceSelector
                      selectedWorkspaceId={selectedWorkspaceId}
                      onWorkspaceChange={setSelectedWorkspaceId}
                      enabled={isAuthenticated}
                    />
                  )}
                  <WorktreeToggle disabled={isLoading} />
                  <RunLocationSelector disabled={isLoading} />
                </div>

                <ChatInput
                  message={message}
                  setMessage={setMessage}
                  onSubmit={handleNewChat}
                  onAttach={handleFileAttach}
                  attachedFiles={attachedFiles}
                  isLoading={isLoading}
                  showLoadingSpinner={true}
                  selectedModelId={selectedModelId}
                  onModelChange={selectModel}
                  showTip={false}
                  placeholder="Message Agentrove... (@ to mention, / for commands)"
                />

                <div className={styles['example-prompts']}>
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="unstyled"
                      onClick={() => setMessage(prompt)}
                      className={styles['example-prompt']}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          );
        case 'editor':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <Editor
                files={fileStructure}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
                openFiles={openFiles}
                onCloseFile={closeFile}
                sandboxId={selectedSandboxId}
                isSandboxSyncing={isFilesMetadataLoading}
                onRefresh={handleRefresh}
                isRefreshing={isRefreshing}
                chatId={undefined}
              />
            </Suspense>
          );
        case 'secrets':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <SecretsView sandboxId={selectedSandboxId} />
            </Suspense>
          );
        case 'diff':
          // No chat yet — the sandbox comes from the selected workspace, so the
          // diff runs at the workspace root and review comments are disabled.
          return (
            <Suspense fallback={viewLoadingFallback}>
              <DiffView chatId={undefined} sandboxId={selectedSandboxId} isVisible={isVisible} />
            </Suspense>
          );
        case 'terminal':
          // No chatId — pre-chat terminal tabs aren't persisted; the shell
          // spawns at the workspace root.
          return (
            <Suspense fallback={viewLoadingFallback}>
              <TerminalContainer
                sandboxId={selectedSandboxId}
                isVisible={isVisible}
                panelKey={`tile-${tileId}`}
              />
            </Suspense>
          );
        default:
          return null;
      }
    },
    [
      attachedFiles,
      handleFileAttach,
      handleNewChat,
      isAuthenticated,
      isLoading,
      message,
      selectModel,
      selectedModelId,
      selectedWorkspaceId,
      isCloud,
      selectedCloudWorkspaceId,
      fileStructure,
      selectedFile,
      setSelectedFile,
      openFiles,
      closeFile,
      selectedSandboxId,
      handleRefresh,
      isRefreshing,
    ],
  );

  return (
    <ChatProvider
      sandboxId={selectedSandboxId}
      fileStructure={fileStructure}
      customSkills={resolvedWorkspaceResources?.skills}
      builtinSlashCommands={resolvedWorkspaceResources?.builtin_slash_commands}
      personas={resolvedPersonas}
    >
      <div className={styles.surface}>
        <SplitViewContainer renderView={renderView} />
      </div>
      <CommandMenu />
    </ChatProvider>
  );
}
