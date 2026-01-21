import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Settings as SettingsIcon, AlertCircle, FileText, FileArchive } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { UserSettings, UserSettingsUpdate } from '@/types';
import {
  queryKeys,
  useSettingsQuery,
  useUpdateSettingsMutation,
  useInfiniteChatsQuery,
  useDeleteChatMutation,
  useDeleteAllChatsMutation,
  useModelsQuery,
} from '@/hooks/queries';
import { Sidebar, useLayoutSidebar } from '@/components/layout';
import {
  Button,
  ConfirmDialog,
  ErrorBoundary,
  Spinner,
  SettingsUploadModal,
} from '@/components/ui';
import toast from 'react-hot-toast';
import { GeneralSettingsTab } from '@/components/settings/tabs/GeneralSettingsTab';
import { ProvidersSettingsTab } from '@/components/settings/tabs/ProvidersSettingsTab';
import { McpSettingsTab } from '@/components/settings/tabs/McpSettingsTab';
import { AgentsSettingsTab } from '@/components/settings/tabs/AgentsSettingsTab';
import { InstructionsSettingsTab } from '@/components/settings/tabs/InstructionsSettingsTab';
import { EnvVarsSettingsTab } from '@/components/settings/tabs/EnvVarsSettingsTab';
import { TasksSettingsTab } from '@/components/settings/tabs/TasksSettingsTab';
import { AgentEditDialog } from '@/components/settings/dialogs/AgentEditDialog';
import { McpDialog } from '@/components/settings/dialogs/McpDialog';
import { EnvVarDialog } from '@/components/settings/dialogs/EnvVarDialog';
import { TaskDialog } from '@/components/settings/dialogs/TaskDialog';
import { ProviderDialog } from '@/components/settings/dialogs/ProviderDialog';
import { SkillsSettingsTab } from '@/components/settings/tabs/SkillsSettingsTab';
import { CommandsSettingsTab } from '@/components/settings/tabs/CommandsSettingsTab';
import { CommandEditDialog } from '@/components/settings/dialogs/CommandEditDialog';
import { PromptsSettingsTab } from '@/components/settings/tabs/PromptsSettingsTab';
import { PromptEditDialog } from '@/components/settings/dialogs/PromptEditDialog';
import { MarketplaceSettingsTab } from '@/components/settings/tabs/MarketplaceSettingsTab';
import type { ApiFieldKey, CustomPrompt, CustomProvider, SandboxProviderType } from '@/types';
import { useCrudForm } from '@/hooks/useCrudForm';
import { useTaskManagement } from '@/hooks/useTaskManagement';
import { useFileResourceManagement } from '@/hooks/useFileResourceManagement';
import { agentService } from '@/services/agentService';
import { skillService } from '@/services/skillService';
import { commandService } from '@/services/commandService';
import { mcpService } from '@/services/mcpService';
import {
  getGeneralSecretFields,
  createDefaultEnvVarForm,
  validateEnvVarForm,
  createDefaultMcpForm,
  validateMcpForm,
} from '@/utils/settings';

type TabKey =
  | 'general'
  | 'providers'
  | 'marketplace'
  | 'mcp'
  | 'agents'
  | 'skills'
  | 'commands'
  | 'prompts'
  | 'env_vars'
  | 'instructions'
  | 'tasks';

const getErrorMessage = (error: unknown): string | undefined =>
  error instanceof Error ? error.message : undefined;

const createFallbackSettings = (): UserSettings => ({
  id: '',
  user_id: '',
  github_personal_access_token: null,
  e2b_api_key: null,
  modal_api_key: null,
  sandbox_provider: null,
  custom_instructions: null,
  custom_providers: null,
  custom_agents: null,
  custom_mcps: null,
  custom_env_vars: null,
  custom_skills: null,
  custom_slash_commands: null,
  custom_prompts: null,
  notification_sound_enabled: true,
  auto_compact_disabled: false,
  attribution_disabled: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const TAB_FIELDS: Record<TabKey, (keyof UserSettings)[]> = {
  general: [
    'github_personal_access_token',
    'e2b_api_key',
    'modal_api_key',
    'sandbox_provider',
    'auto_compact_disabled',
    'attribution_disabled',
  ],
  providers: ['custom_providers'],
  marketplace: [],
  mcp: ['custom_mcps'],
  agents: ['custom_agents'],
  skills: ['custom_skills'],
  commands: ['custom_slash_commands'],
  prompts: ['custom_prompts'],
  env_vars: ['custom_env_vars'],
  instructions: ['custom_instructions'],
  tasks: [],
};

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: models = [] } = useModelsQuery();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);

  const tabButtonClasses = (isActive: boolean) =>
    `${
      isActive
        ? 'border-b-2 border-text-primary dark:border-text-dark-primary text-text-primary dark:text-text-dark-primary'
        : 'text-text-tertiary dark:text-text-dark-tertiary hover:text-text-secondary dark:hover:text-text-dark-secondary'
    } pb-2 text-xs font-medium transition-colors`;

  const tabs: { id: TabKey; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'providers', label: 'Providers' },
    { id: 'marketplace', label: 'Marketplace' },
    { id: 'mcp', label: 'MCP' },
    { id: 'agents', label: 'Agents' },
    { id: 'skills', label: 'Skills' },
    { id: 'commands', label: 'Commands' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'env_vars', label: 'Environment Variables' },
    { id: 'instructions', label: 'Instructions' },
    { id: 'tasks', label: 'Tasks' },
  ];

  const generalSecretFields = getGeneralSecretFields();

  const { data: settings, isLoading: loading, error: fetchError } = useSettingsQuery();
  const {
    data: chatsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteChatsQuery();

  const chats = useMemo(() => {
    if (!chatsData?.pages) return [];
    return chatsData.pages.flatMap((page) => page.items);
  }, [chatsData?.pages]);

  const { mutate: deleteChat } = useDeleteChatMutation();
  const deleteAllChats = useDeleteAllChatsMutation();

  const [localSettings, setLocalSettings] = useState<UserSettings>(
    () => settings ?? createFallbackSettings(),
  );
  const localSettingsRef = useRef<UserSettings>(localSettings);

  const defaultModelId = models.length > 0 ? models[0].model_id : '';

  const manualUpdateMutation = useUpdateSettingsMutation({
    onSuccess: (data) => {
      toast.success('Settings saved successfully');
      setLocalSettings(data);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error) || 'Failed to save settings');
    },
  });

  const instantUpdateMutation = useUpdateSettingsMutation();

  useEffect(() => {
    localSettingsRef.current = localSettings;
  }, [localSettings]);

  const buildChangedPayload = useCallback(
    (current: UserSettings, previous: UserSettings): UserSettingsUpdate => {
      const payload: UserSettingsUpdate = {};
      const fields: (keyof UserSettingsUpdate)[] = [
        'github_personal_access_token',
        'e2b_api_key',
        'modal_api_key',
        'sandbox_provider',
        'custom_instructions',
        'custom_providers',
        'custom_agents',
        'custom_mcps',
        'custom_env_vars',
        'custom_skills',
        'custom_slash_commands',
        'custom_prompts',
        'notification_sound_enabled',
        'auto_compact_disabled',
        'attribution_disabled',
      ];

      for (const field of fields) {
        if (JSON.stringify(current[field]) !== JSON.stringify(previous[field])) {
          payload[field] = (current[field] ?? null) as UserSettingsUpdate[typeof field];
        }
      }
      return payload;
    },
    [],
  );

  const persistSettings = useCallback(
    async (
      updater: (previous: UserSettings) => UserSettings,
      options: { successMessage?: string; errorMessage?: string } = {},
    ) => {
      const previousSettings = localSettingsRef.current ?? createFallbackSettings();
      const updatedSettings = updater(previousSettings);

      setLocalSettings(updatedSettings);
      localSettingsRef.current = updatedSettings;

      try {
        const payload = buildChangedPayload(updatedSettings, previousSettings);
        if (Object.keys(payload).length === 0) return;

        const result = await instantUpdateMutation.mutateAsync(payload);
        setLocalSettings(result);
        localSettingsRef.current = result;
        if (options.successMessage) {
          toast.success(options.successMessage);
        }
      } catch (error) {
        setLocalSettings(previousSettings);
        localSettingsRef.current = previousSettings;
        toast.error(options.errorMessage || getErrorMessage(error) || 'Failed to update settings');
        throw error;
      }
    },
    [instantUpdateMutation, buildChangedPayload],
  );

  const agentManagement = useFileResourceManagement(
    localSettings,
    persistSettings,
    setLocalSettings,
    {
      settingsKey: 'custom_agents',
      itemName: 'Agent',
      maxItems: 10,
      uploadFn: agentService.uploadAgent,
      deleteFn: agentService.deleteAgent,
      updateFn: agentService.updateAgent,
    },
  );

  const mcpCrud = useCrudForm(localSettings, persistSettings, setLocalSettings, {
    createDefault: createDefaultMcpForm,
    validateForm: (form, editingIndex) =>
      validateMcpForm(form, editingIndex, localSettings.custom_mcps || []),
    getArrayKey: 'custom_mcps',
    itemName: 'MCP',
    createFn: mcpService.createMcp,
    updateFn: mcpService.updateMcp,
    deleteFn: mcpService.deleteMcp,
    toggleFn: (name, enabled) => mcpService.updateMcp(name, { enabled }),
  });

  const envVarCrud = useCrudForm(localSettings, persistSettings, setLocalSettings, {
    createDefault: createDefaultEnvVarForm,
    validateForm: (form, editingIndex) =>
      validateEnvVarForm(form, editingIndex, localSettings.custom_env_vars || []),
    getArrayKey: 'custom_env_vars',
    itemName: 'environment variable',
  });

  const promptCrud = useCrudForm<CustomPrompt>(localSettings, persistSettings, setLocalSettings, {
    createDefault: (): CustomPrompt => ({ name: '', content: '' }),
    validateForm: (form, editingIndex) => {
      if (!form.name.trim()) return 'Name is required';
      if (!form.content.trim()) return 'Content is required';
      const prompts = localSettings.custom_prompts || [];
      const duplicate = prompts.some((p, i) => p.name === form.name.trim() && i !== editingIndex);
      if (duplicate) return 'A prompt with this name already exists';
      return null;
    },
    getArrayKey: 'custom_prompts',
    itemName: 'prompt',
  });

  const skillManagement = useFileResourceManagement(
    localSettings,
    persistSettings,
    setLocalSettings,
    {
      settingsKey: 'custom_skills',
      itemName: 'Skill',
      maxItems: 10,
      uploadFn: skillService.uploadSkill,
      deleteFn: skillService.deleteSkill,
    },
  );

  const commandManagement = useFileResourceManagement(
    localSettings,
    persistSettings,
    setLocalSettings,
    {
      settingsKey: 'custom_slash_commands',
      itemName: 'Command',
      maxItems: 10,
      uploadFn: commandService.uploadCommand,
      deleteFn: commandService.deleteCommand,
      updateFn: commandService.updateCommand,
    },
  );
  const taskManagement = useTaskManagement(defaultModelId);

  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null);

  const handleAddProvider = () => {
    setEditingProvider(null);
    setIsProviderDialogOpen(true);
  };

  const handleEditProvider = (provider: CustomProvider) => {
    setEditingProvider(provider);
    setIsProviderDialogOpen(true);
  };

  const handleDeleteProvider = (providerId: string) => {
    void persistSettings(
      (prev) => ({
        ...prev,
        custom_providers: (prev.custom_providers || []).filter((p) => p.id !== providerId),
      }),
      { successMessage: 'Provider deleted' },
    ).then(() => queryClient.invalidateQueries({ queryKey: [queryKeys.models] }));
  };

  const handleToggleProvider = (providerId: string, enabled: boolean) => {
    void persistSettings((prev) => ({
      ...prev,
      custom_providers: (prev.custom_providers || []).map((p) =>
        p.id === providerId ? { ...p, enabled } : p,
      ),
    })).then(() => queryClient.invalidateQueries({ queryKey: [queryKeys.models] }));
  };

  const handleSaveProvider = (provider: CustomProvider) => {
    const providers = localSettings.custom_providers || [];
    const existingIndex = providers.findIndex((p) => p.id === provider.id);

    if (existingIndex >= 0) {
      void persistSettings(
        (prev) => ({
          ...prev,
          custom_providers: (prev.custom_providers || []).map((p) =>
            p.id === provider.id ? provider : p,
          ),
        }),
        { successMessage: 'Provider updated' },
      ).then(() => queryClient.invalidateQueries({ queryKey: [queryKeys.models] }));
    } else {
      void persistSettings(
        (prev) => ({
          ...prev,
          custom_providers: [...(prev.custom_providers || []), provider],
        }),
        { successMessage: 'Provider added' },
      ).then(() => queryClient.invalidateQueries({ queryKey: [queryKeys.models] }));
    }
    setIsProviderDialogOpen(false);
    setEditingProvider(null);
  };

  const handleProviderDialogClose = () => {
    setIsProviderDialogOpen(false);
    setEditingProvider(null);
  };

  const [revealedFields, setRevealedFields] = useState<Record<ApiFieldKey, boolean>>({
    github_personal_access_token: false,
    e2b_api_key: false,
    modal_api_key: false,
  });

  const hasUnsavedChanges = useMemo(() => {
    if (!settings) return false;
    if (activeTab !== 'general' && activeTab !== 'instructions') return false;

    const changedPayload = buildChangedPayload(localSettings, settings);
    const currentTabFields = TAB_FIELDS[activeTab] ?? [];

    return currentTabFields.some((field) => field in changedPayload);
  }, [localSettings, settings, activeTab, buildChangedPayload]);

  const handleCancel = () => {
    if (settings) {
      setLocalSettings({ ...settings });
      toast.success('Changes discarded');
    }
  };

  const handleSave = () => {
    const payload = buildChangedPayload(localSettings, settings ?? createFallbackSettings());
    if (Object.keys(payload).length === 0) {
      toast.success('No changes to save');
      return;
    }
    manualUpdateMutation.mutate(payload);
  };

  const handleInputChange = <K extends keyof UserSettings>(field: K, value: UserSettings[K]) => {
    setLocalSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleSecretFieldChange = (field: ApiFieldKey, value: string) => {
    handleInputChange(field, value);
  };

  const toggleFieldVisibility = (field: ApiFieldKey) => {
    setRevealedFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleChatSelect = useCallback(
    (chatId: string) => {
      setSelectedChatId(chatId);
      navigate(`/chat/${chatId}`);
    },
    [navigate],
  );

  const handleDeleteChat = useCallback(
    (chatId: string) => {
      deleteChat(chatId, {
        onSuccess: () => {
          if (selectedChatId === chatId) {
            setSelectedChatId(null);
          }
        },
      });
    },
    [deleteChat, selectedChatId],
  );

  const handleDeleteAllChats = () => {
    setIsDeleteAllDialogOpen(true);
  };

  const handleNotificationSoundChange = (enabled: boolean) => {
    persistSettings((prev) => ({ ...prev, notification_sound_enabled: enabled }));
  };

  const handleAutoCompactDisabledChange = (disabled: boolean) => {
    persistSettings((prev) => ({ ...prev, auto_compact_disabled: disabled }));
  };

  const handleAttributionDisabledChange = (disabled: boolean) => {
    persistSettings((prev) => ({ ...prev, attribution_disabled: disabled }));
  };

  const handleSandboxProviderChange = (provider: SandboxProviderType) => {
    persistSettings((prev) => ({ ...prev, sandbox_provider: provider }));
  };

  const sidebarContent = useMemo(
    () => (
      <Sidebar
        chats={chats}
        selectedChatId={selectedChatId}
        onChatSelect={handleChatSelect}
        onDeleteChat={handleDeleteChat}
        hasNextPage={hasNextPage}
        fetchNextPage={fetchNextPage}
        isFetchingNextPage={isFetchingNextPage}
      />
    ),
    [
      chats,
      fetchNextPage,
      handleChatSelect,
      handleDeleteChat,
      hasNextPage,
      isFetchingNextPage,
      selectedChatId,
    ],
  );

  useLayoutSidebar(sidebarContent);

  const confirmDeleteAllChats = async () => {
    try {
      await deleteAllChats.mutateAsync();
      toast.success('All chats deleted successfully');
      setSelectedChatId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete all chats');
    } finally {
      setIsDeleteAllDialogOpen(false);
    }
  };

  useEffect(() => {
    if (settings) {
      setLocalSettings({ ...settings });
    }
  }, [settings]);

  const errorMessage =
    getErrorMessage(fetchError) ?? getErrorMessage(manualUpdateMutation.error) ?? null;

  if (loading) {
    return (
      <div className="min-h-viewport flex items-center justify-center bg-surface-secondary dark:bg-surface-dark-secondary">
        <Spinner size="lg" className="text-brand-600" />
      </div>
    );
  }

  if (fetchError && !settings) {
    return (
      <div className="min-h-viewport flex items-center justify-center bg-surface-secondary dark:bg-surface-dark-secondary">
        <div className="text-text-primary dark:text-text-dark-primary">Failed to load settings</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full overflow-x-hidden bg-surface-secondary dark:bg-surface-dark-secondary">
      <div className="flex min-w-0 flex-1 justify-center px-4 py-6">
        <div className="w-full min-w-0 max-w-3xl">
          <div className="mb-6">
            <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary dark:text-text-dark-primary">
              <SettingsIcon className="h-4 w-4" />
              Settings
            </h1>
          </div>

          <div className="mb-6">
            <nav
              className="scrollbar-none -mx-4 flex overflow-x-auto border-b border-border px-4 dark:border-border-dark sm:mx-0 sm:px-0"
              role="tablist"
              aria-label="Settings sections"
            >
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  variant="unstyled"
                  className={cn(
                    tabButtonClasses(activeTab === tab.id),
                    'mr-4 shrink-0 whitespace-nowrap last:mr-0 sm:mr-6',
                  )}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`${tab.id}-panel`}
                  id={`${tab.id}-tab`}
                >
                  {tab.label}
                </Button>
              ))}
            </nav>
          </div>

          {hasUnsavedChanges && (
            <div className="animate-in fade-in slide-in-from-top-2 mb-4 flex flex-col gap-3 rounded-lg border border-l-4 border-border border-l-brand-500 bg-surface-secondary p-4 shadow-sm duration-300 dark:border-border-dark dark:border-l-brand-600 dark:bg-surface-dark-secondary sm:flex-row sm:items-center sm:justify-between sm:gap-0">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-500" />
                <span className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                  You have unsaved changes
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={handleCancel}
                  variant="outline"
                  size="sm"
                  className="flex-1 text-text-secondary dark:text-text-dark-secondary sm:flex-none"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  variant="primary"
                  size="sm"
                  className="flex-1 sm:flex-none"
                  isLoading={manualUpdateMutation.isPending}
                  loadingText="Saving..."
                >
                  Save Changes
                </Button>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="mb-4 rounded-md border border-error-200 bg-error-50 p-3 dark:border-error-800 dark:bg-error-900/20">
              <p className="text-xs text-error-700 dark:text-error-400">{errorMessage}</p>
            </div>
          )}

          <ErrorBoundary>
            <div className="min-w-0 space-y-6">
              {activeTab === 'general' && (
                <div role="tabpanel" id="general-panel" aria-labelledby="general-tab">
                  <GeneralSettingsTab
                    fields={generalSecretFields}
                    settings={localSettings}
                    savedSettings={settings}
                    revealedFields={revealedFields}
                    onSecretChange={handleSecretFieldChange}
                    onToggleVisibility={toggleFieldVisibility}
                    onDeleteAllChats={handleDeleteAllChats}
                    onNotificationSoundChange={handleNotificationSoundChange}
                    onAutoCompactDisabledChange={handleAutoCompactDisabledChange}
                    onAttributionDisabledChange={handleAttributionDisabledChange}
                    onSandboxProviderChange={handleSandboxProviderChange}
                  />
                </div>
              )}

              {activeTab === 'providers' && (
                <div role="tabpanel" id="providers-panel" aria-labelledby="providers-tab">
                  <ProvidersSettingsTab
                    providers={localSettings.custom_providers ?? null}
                    onAddProvider={handleAddProvider}
                    onEditProvider={handleEditProvider}
                    onDeleteProvider={handleDeleteProvider}
                    onToggleProvider={handleToggleProvider}
                  />
                </div>
              )}

              {activeTab === 'marketplace' && (
                <div role="tabpanel" id="marketplace-panel" aria-labelledby="marketplace-tab">
                  <MarketplaceSettingsTab />
                </div>
              )}

              {activeTab === 'mcp' && (
                <div role="tabpanel" id="mcp-panel" aria-labelledby="mcp-tab">
                  <McpSettingsTab
                    mcps={localSettings.custom_mcps ?? null}
                    onAddMcp={mcpCrud.handleAdd}
                    onEditMcp={mcpCrud.handleEdit}
                    onDeleteMcp={mcpCrud.handleDelete}
                    onToggleMcp={mcpCrud.handleToggleEnabled}
                  />
                </div>
              )}

              {activeTab === 'agents' && (
                <div role="tabpanel" id="agents-panel" aria-labelledby="agents-tab">
                  <AgentsSettingsTab
                    agents={localSettings.custom_agents ?? null}
                    onAddAgent={agentManagement.handleAdd}
                    onEditAgent={agentManagement.handleEdit}
                    onDeleteAgent={agentManagement.handleDelete}
                    onToggleAgent={agentManagement.handleToggle}
                  />
                </div>
              )}

              {activeTab === 'skills' && (
                <div role="tabpanel" id="skills-panel" aria-labelledby="skills-tab">
                  <SkillsSettingsTab
                    skills={localSettings.custom_skills ?? null}
                    onAddSkill={skillManagement.handleAdd}
                    onDeleteSkill={skillManagement.handleDelete}
                    onToggleSkill={skillManagement.handleToggle}
                  />
                </div>
              )}

              {activeTab === 'commands' && (
                <div role="tabpanel" id="commands-panel" aria-labelledby="commands-tab">
                  <CommandsSettingsTab
                    commands={localSettings.custom_slash_commands ?? null}
                    onAddCommand={commandManagement.handleAdd}
                    onEditCommand={commandManagement.handleEdit}
                    onDeleteCommand={commandManagement.handleDelete}
                    onToggleCommand={commandManagement.handleToggle}
                  />
                </div>
              )}

              {activeTab === 'prompts' && (
                <div role="tabpanel" id="prompts-panel" aria-labelledby="prompts-tab">
                  <PromptsSettingsTab
                    prompts={localSettings.custom_prompts ?? null}
                    onAddPrompt={promptCrud.handleAdd}
                    onEditPrompt={promptCrud.handleEdit}
                    onDeletePrompt={promptCrud.handleDelete}
                  />
                </div>
              )}

              {activeTab === 'env_vars' && (
                <div role="tabpanel" id="env_vars-panel" aria-labelledby="env_vars-tab">
                  <EnvVarsSettingsTab
                    envVars={localSettings.custom_env_vars ?? null}
                    onAddEnvVar={envVarCrud.handleAdd}
                    onEditEnvVar={envVarCrud.handleEdit}
                    onDeleteEnvVar={envVarCrud.handleDelete}
                  />
                </div>
              )}

              {activeTab === 'instructions' && (
                <div role="tabpanel" id="instructions-panel" aria-labelledby="instructions-tab">
                  <InstructionsSettingsTab
                    instructions={localSettings.custom_instructions || ''}
                    onInstructionsChange={(value) =>
                      handleInputChange('custom_instructions', value)
                    }
                  />
                </div>
              )}

              {activeTab === 'tasks' && (
                <div role="tabpanel" id="tasks-panel" aria-labelledby="tasks-tab">
                  <TasksSettingsTab
                    onAddTask={taskManagement.handleAddTask}
                    onEditTask={taskManagement.handleEditTask}
                  />
                </div>
              )}
            </div>
          </ErrorBoundary>
        </div>
      </div>

      <ConfirmDialog
        isOpen={isDeleteAllDialogOpen}
        onClose={() => setIsDeleteAllDialogOpen(false)}
        onConfirm={confirmDeleteAllChats}
        title="Delete All Chats"
        message="Are you sure you want to delete all chats? This action cannot be undone."
        confirmLabel="Delete All"
        cancelLabel="Cancel"
      />

      <SettingsUploadModal
        isOpen={agentManagement.isDialogOpen}
        error={agentManagement.uploadError}
        uploading={agentManagement.isUploading}
        onClose={agentManagement.handleDialogClose}
        onUpload={agentManagement.handleUpload}
        title="Upload Agent"
        acceptedExtension=".md"
        icon={FileText}
        hintText="The .md file must include YAML frontmatter with name and description fields. Optional fields: model, allowed_tools."
      />

      <AgentEditDialog
        isOpen={agentManagement.isEditDialogOpen}
        agent={agentManagement.editingItem}
        error={agentManagement.editError}
        saving={agentManagement.isSavingEdit}
        onClose={agentManagement.handleEditDialogClose}
        onSave={agentManagement.handleSaveEdit}
      />

      <McpDialog
        isOpen={mcpCrud.isDialogOpen}
        isEditing={mcpCrud.editingIndex !== null}
        mcp={mcpCrud.form}
        error={mcpCrud.formError}
        onClose={mcpCrud.handleDialogClose}
        onSubmit={mcpCrud.handleSave}
        onMcpChange={mcpCrud.handleFormChange}
      />

      <EnvVarDialog
        isOpen={envVarCrud.isDialogOpen}
        isEditing={envVarCrud.editingIndex !== null}
        envVar={envVarCrud.form}
        error={envVarCrud.formError}
        onClose={envVarCrud.handleDialogClose}
        onSubmit={envVarCrud.handleSave}
        onEnvVarChange={envVarCrud.handleFormChange}
      />

      <PromptEditDialog
        isOpen={promptCrud.isDialogOpen}
        isEditing={promptCrud.editingIndex !== null}
        prompt={promptCrud.form}
        error={promptCrud.formError}
        onClose={promptCrud.handleDialogClose}
        onSubmit={promptCrud.handleSave}
        onPromptChange={promptCrud.handleFormChange}
      />

      <TaskDialog
        isOpen={taskManagement.isTaskDialogOpen}
        isEditing={taskManagement.editingTaskId !== null}
        task={taskManagement.taskForm}
        error={taskManagement.taskFormError}
        onClose={taskManagement.handleTaskDialogClose}
        onSubmit={taskManagement.handleSaveTask}
        onTaskChange={taskManagement.handleTaskFormChange}
      />

      <SettingsUploadModal
        isOpen={skillManagement.isDialogOpen}
        error={skillManagement.uploadError}
        uploading={skillManagement.isUploading}
        onClose={skillManagement.handleDialogClose}
        onUpload={skillManagement.handleUpload}
        title="Upload Skill"
        acceptedExtension=".zip"
        icon={FileArchive}
        hintText="The ZIP must contain a SKILL.md file with YAML frontmatter including name and description fields."
      />

      <SettingsUploadModal
        isOpen={commandManagement.isDialogOpen}
        error={commandManagement.uploadError}
        uploading={commandManagement.isUploading}
        onClose={commandManagement.handleDialogClose}
        onUpload={commandManagement.handleUpload}
        title="Upload Slash Command"
        acceptedExtension=".md"
        icon={FileText}
        hintText="The .md file must include YAML frontmatter with name and description fields. Optional fields: argument-hint, allowed-tools, model."
      />

      <CommandEditDialog
        isOpen={commandManagement.isEditDialogOpen}
        command={commandManagement.editingItem}
        error={commandManagement.editError}
        saving={commandManagement.isSavingEdit}
        onClose={commandManagement.handleEditDialogClose}
        onSave={commandManagement.handleSaveEdit}
      />

      <ProviderDialog
        isOpen={isProviderDialogOpen}
        provider={editingProvider}
        onClose={handleProviderDialogClose}
        onSave={handleSaveProvider}
      />
    </div>
  );
};

export default SettingsPage;
