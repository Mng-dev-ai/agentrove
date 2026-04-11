import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
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
import {
  useWorkspacesQuery,
  useWorkspaceResourcesQuery,
} from '@/hooks/queries/useWorkspaceQueries';
import { useFilesMetadataQuery } from '@/hooks/queries/useSandboxQueries';
import { useModelSelection } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { ChatProvider } from '@/contexts/ChatContext';
import { buildFileStructureFromSandboxFiles } from '@/utils/file';

const EXAMPLE_PROMPTS = [
  'Build a REST API with authentication',
  'Find and fix bugs in my codebase',
  'Refactor this project to use TypeScript',
];

export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const attachedFiles = useChatStore((state) => state.attachedFiles);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { selectedModelId, selectModel } = useModelSelection({
    enabled: isAuthenticated,
  });

  const { data: workspacesData } = useWorkspacesQuery({ enabled: isAuthenticated });
  const workspaces = workspacesData?.items ?? [];

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
    if (
      initialWorkspaceId &&
      initialWorkspaceId !== consumedWorkspaceRef.current &&
      workspaces.some((ws) => ws.id === initialWorkspaceId)
    ) {
      consumedWorkspaceRef.current = initialWorkspaceId;
      setSelectedWorkspaceId(initialWorkspaceId);
    }
  }, [initialWorkspaceId, workspaces]);

  useEffect(() => {
    if (
      selectedWorkspaceId &&
      workspaces.length &&
      !workspaces.some((ws) => ws.id === selectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(null);
    }
  }, [workspaces, selectedWorkspaceId]);

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

  const { data: filesMetadata = [] } = useFilesMetadataQuery(selectedSandboxId, {
    enabled: isAuthenticated && !!selectedSandboxId,
  });

  const fileStructure = useMemo(
    () => buildFileStructureFromSandboxFiles(filesMetadata, []),
    [filesMetadata],
  );

  const { data: settings } = useSettingsQuery({
    enabled: isAuthenticated,
  });

  useMountEffect(() => {
    useChatStore.getState().setCurrentChat(null);
    useUIStore.getState().exitSplitMode();
  });

  const handleFileAttach = useCallback((files: File[]) => {
    useChatStore.getState().setAttachedFiles(files);
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

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex flex-1">
        <div className="flex flex-1 items-center justify-center px-4 pb-10">
          <div className="w-full max-w-2xl">
            <div className="relative z-30 mb-2 flex items-center gap-1 px-4 sm:px-6">
              <WorkspaceSelector
                selectedWorkspaceId={selectedWorkspaceId}
                onWorkspaceChange={setSelectedWorkspaceId}
                enabled={isAuthenticated}
              />
              <WorktreeToggle disabled={isLoading} />
            </div>

            <ChatProvider
              fileStructure={fileStructure}
              customSkills={workspaceResources?.skills}
              builtinSlashCommands={workspaceResources?.builtin_slash_commands}
              personas={settings?.personas}
            >
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
            </ChatProvider>

            <div className="mt-4 flex flex-wrap justify-center gap-2 px-4 sm:px-6">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setMessage(prompt)}
                  className="rounded-lg border border-border/50 px-3 py-2 text-2xs text-text-tertiary transition-colors duration-200 hover:border-border-hover hover:bg-surface-hover hover:text-text-primary dark:border-border-dark/50 dark:text-text-dark-tertiary dark:hover:border-border-dark-hover dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
