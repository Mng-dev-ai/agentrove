import {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  ReactNode,
  lazy,
  Suspense,
} from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Sidebar } from '@/components/layout/Sidebar';
import { useLayoutSidebar } from '@/components/layout/layoutState';
import { Input as ChatInput } from '@/components/chat/message-input/Input';
import { WorkspaceSelector } from '@/components/chat/workspace-selector/WorkspaceSelector';
import { WorktreeToggle } from '@/components/chat/worktree-selector/WorktreeToggle';
import { useChatStore } from '@/store/chatStore';
import { useUIStore } from '@/store/uiStore';
import { useModelStore } from '@/store/modelStore';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import { useAuthStore } from '@/store/authStore';
import { useCreateChatMutation } from '@/hooks/queries/useChatQueries';
import { useWorkspacesList, useWorkspaceResourcesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useFilesMetadataQuery } from '@/hooks/queries/useSandboxQueries';
import { useModelSelection } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { ChatProvider } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/primitives/Button';
import { buildFileStructureFromSandboxFiles } from '@/utils/file';
import { SplitViewContainer } from '@/components/ui/SplitViewContainer';
import { CommandMenu } from '@/components/ui/CommandMenu';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { useEditorState } from '@/hooks/useEditorState';
import { usePendingFileOpen } from '@/hooks/usePendingFileOpen';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback';
import { PENDING_NEW_CHAT_KEY, type MosaicTileId } from '@/types/ui.types';
import { tileIdToViewType } from '@/utils/mosaicHelpers';

const Editor = lazy(() =>
  import('@/components/editor/editor-core/Editor').then((m) => ({ default: m.Editor })),
);
const SecretsView = lazy(() =>
  import('@/components/sandbox/secrets/SecretsView').then((m) => ({ default: m.SecretsView })),
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

  const createChat = useCreateChatMutation();
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const consumedInitialMessageRef = useRef(false);
  const routeState = location.state as { workspaceId?: string; initialMessage?: string } | null;
  const initialWorkspaceId = routeState?.workspaceId ?? null;
  const initialMessage = routeState?.initialMessage ?? null;
  const consumedWorkspaceRef = useRef<string | null>(null);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaces.length) return;
    if (
      initialWorkspaceId &&
      initialWorkspaceId !== consumedWorkspaceRef.current &&
      workspaces.some((ws) => ws.id === initialWorkspaceId)
    ) {
      consumedWorkspaceRef.current = initialWorkspaceId;
      setSelectedWorkspaceId(initialWorkspaceId);
      return;
    }
    if (selectedWorkspaceId && workspaces.some((ws) => ws.id === selectedWorkspaceId)) return;
    setSelectedWorkspaceId(workspaces[0].id);
  }, [initialWorkspaceId, workspaces, selectedWorkspaceId]);

  if (initialMessage && !consumedInitialMessageRef.current) {
    consumedInitialMessageRef.current = true;
    setMessage(initialMessage);
  }

  const { data: workspaceResources } = useWorkspaceResourcesQuery(
    selectedWorkspaceId ?? undefined,
    {
      enabled: isAuthenticated && !!selectedWorkspaceId,
    },
  );

  // Enable @ file mentions in the input bar before a chat is created
  const selectedSandboxId = selectedWorkspaceId
    ? workspaces.find((ws) => ws.id === selectedWorkspaceId)?.sandbox_id
    : undefined;

  const { data: filesMetadata = [], refetch: refetchFilesMetadata } = useFilesMetadataQuery(
    selectedSandboxId,
    {
      enabled: isAuthenticated && !!selectedSandboxId,
    },
  );

  const fileStructure = useMemo(
    () => buildFileStructureFromSandboxFiles(filesMetadata, []),
    [filesMetadata],
  );

  const { selectedFile, setSelectedFile, isRefreshing, handleRefresh, handleFileSelect } =
    useEditorState(refetchFilesMetadata);

  const prevSandboxIdRef = useRef(selectedSandboxId);
  if (prevSandboxIdRef.current !== selectedSandboxId) {
    prevSandboxIdRef.current = selectedSandboxId;
    setSelectedFile(null);
  }

  // No chat exists on the landing page, so there are no chat-bound file jumps.
  usePendingFileOpen(fileStructure, setSelectedFile, undefined);

  const { data: settings } = useSettingsQuery({
    enabled: isAuthenticated,
  });

  useMountEffect(() => {
    useChatStore.getState().setCurrentChat(null);
    // Reset to the agent (workspace selector) leaf — a stale split layout from a prior chat
    // would otherwise persist into the landing screen.
    useUIStore.getState().setCurrentView('agent');
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

      if (!selectedWorkspaceId) {
        toast.error('Please select a workspace');
        return;
      }

      setIsLoading(true);
      try {
        const title = trimmedPrompt.replace(/\s+/g, ' ').slice(0, 80) || 'New Chat';
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
    (tileId: MosaicTileId): ReactNode => {
      switch (tileIdToViewType(tileId)) {
        case 'agent':
          return (
            <div className="flex h-full w-full items-center justify-center px-4 pb-10">
              <div className="w-full max-w-2xl">
                <div className="relative z-30 mb-2 flex items-center gap-1 px-4 sm:px-6">
                  <WorkspaceSelector
                    selectedWorkspaceId={selectedWorkspaceId}
                    onWorkspaceChange={setSelectedWorkspaceId}
                    enabled={isAuthenticated}
                  />
                  <WorktreeToggle disabled={isLoading} />
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

                <div className="mt-4 flex flex-wrap justify-center gap-2 px-4 sm:px-6">
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="unstyled"
                      onClick={() => setMessage(prompt)}
                      className="rounded-lg border border-border/50 px-3 py-2 text-2xs text-text-tertiary transition-colors duration-200 hover:border-border-hover hover:bg-surface-hover hover:text-text-primary dark:border-border-dark/50 dark:text-text-dark-tertiary dark:hover:border-border-dark-hover dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
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
                onFileSelect={handleFileSelect}
                sandboxId={selectedSandboxId}
                isSandboxSyncing={false}
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
      fileStructure,
      selectedFile,
      handleFileSelect,
      selectedSandboxId,
      handleRefresh,
      isRefreshing,
    ],
  );

  return (
    <ChatProvider
      sandboxId={selectedSandboxId}
      fileStructure={fileStructure}
      customSkills={workspaceResources?.skills}
      builtinSlashCommands={workspaceResources?.builtin_slash_commands}
      personas={settings?.personas}
    >
      <div className="flex h-full flex-1 overflow-hidden bg-surface text-text-primary dark:bg-surface-dark dark:text-text-dark-primary">
        <SplitViewContainer renderView={renderView} />
      </div>
      <CommandMenu />
    </ChatProvider>
  );
}
