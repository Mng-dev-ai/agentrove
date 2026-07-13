import { useState, useCallback, useEffect, useRef, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { UserSettings, UserSettingsUpdate } from '@/types/user.types';
import type { ApiFieldKey } from '@/types/settings.types';
import { useDeleteAllChatsMutation } from '@/hooks/queries/useChatQueries';
import { useSettingsQuery, useUpdateSettingsMutation } from '@/hooks/queries/useSettingsQueries';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary/ErrorBoundary';
import toast from 'react-hot-toast';
import { GeneralSettingsTab } from '@/components/settings/tabs/GeneralSettingsTab/GeneralSettingsTab';
import { SkillsSettingsTab } from '@/components/settings/tabs/SkillsSettingsTab/SkillsSettingsTab';
import { CloudSettingsTab } from '@/components/settings/tabs/CloudSettingsTab/CloudSettingsTab';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';
import { useLogout } from '@/hooks/useLogout';
import { getGeneralSecretFields } from '@/utils/settings';
import { lazyNamed } from '@/utils/lazyNamed';
import { SettingsSidebarNav } from './SettingsSidebarNav';
import { SettingsMobileNav } from './SettingsMobileNav';
import { TAB_LABELS, type TabKey } from './settingsNavItems';
import styles from './SettingsPage.module.scss';
const PersonasSettingsTab = lazyNamed(
  () => import('@/components/settings/tabs/PersonasSettingsTab/PersonasSettingsTab'),
  'PersonasSettingsTab',
);
const StreamActionsSettingsTab = lazyNamed(
  () => import('@/components/settings/tabs/StreamActionsSettingsTab/StreamActionsSettingsTab'),
  'StreamActionsSettingsTab',
);
const AutomationsSettingsTab = lazyNamed(
  () => import('@/components/settings/tabs/AutomationsSettingsTab/AutomationsSettingsTab'),
  'AutomationsSettingsTab',
);
const EnvVarsSettingsTab = lazyNamed(
  () => import('@/components/settings/tabs/EnvVarsSettingsTab/EnvVarsSettingsTab'),
  'EnvVarsSettingsTab',
);
const InstructionsSettingsTab = lazyNamed(
  () => import('@/components/settings/tabs/InstructionsSettingsTab/InstructionsSettingsTab'),
  'InstructionsSettingsTab',
);

const getErrorMessage = (error: unknown): string | undefined =>
  error instanceof Error ? error.message : undefined;

const tabLoadingFallback = (
  <div className={styles['tab-loading']}>
    <Spinner size="md" className={styles.spinner} />
  </div>
);

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: currentUser } = useCurrentUserQuery({ enabled: isAuthenticated });
  const userDisplayName = currentUser?.username || currentUser?.email || '';
  const logoutMutation = useLogout();
  // Honor a deep-link tab (e.g. the "Connect a cloud instance" CTA → Cloud tab).
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const requested = (location.state as { tab?: TabKey } | null)?.tab;
    return requested && requested in TAB_LABELS ? requested : 'general';
  });
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const generalSecretFields = getGeneralSecretFields();

  const { data: settings, error: fetchError } = useSettingsQuery();
  const deleteAllChats = useDeleteAllChatsMutation();

  const [localSettings, setLocalSettings] = useState<UserSettings | null>(settings ?? null);
  const localSettingsRef = useRef<UserSettings | null>(localSettings);

  const instantUpdateMutation = useUpdateSettingsMutation();

  useEffect(() => {
    localSettingsRef.current = localSettings;
  }, [localSettings]);

  const buildChangedPayload = useCallback(
    (current: UserSettings, previous: UserSettings): UserSettingsUpdate => {
      const payload: UserSettingsUpdate = {};
      const fields: (keyof UserSettingsUpdate)[] = [
        'github_personal_access_token',
        'custom_instructions',
        'custom_env_vars',
        'personas',
        'stream_actions',
        'notifications_enabled',
        'title_model_id',
      ];

      for (const field of fields) {
        if (JSON.stringify(current[field]) !== JSON.stringify(previous[field])) {
          // Indexing UserSettingsUpdate by a union key collapses the assignment target
          // to the intersection of the value types (undefined); cast past it.
          payload[field] = (current[field] ?? null) as never;
        }
      }
      return payload;
    },
    [],
  );

  const persistSettings = useCallback(
    async (
      updater: (previous: UserSettings) => UserSettings,
      options: { errorMessage?: string } = {},
    ) => {
      if (!localSettingsRef.current) {
        throw new Error('Settings data is required before persisting changes');
      }

      const previousSettings = localSettingsRef.current;
      const updatedSettings = updater(previousSettings);

      setLocalSettings(updatedSettings);
      localSettingsRef.current = updatedSettings;

      try {
        const payload = buildChangedPayload(updatedSettings, previousSettings);
        if (Object.keys(payload).length === 0) return;

        const result = await instantUpdateMutation.mutateAsync(payload);
        setLocalSettings(result);
        localSettingsRef.current = result;
        // Stable id collapses rapid successive autosaves into one updating toast
        toast.success('Saved', { id: 'settings-saved' });
      } catch (error) {
        setLocalSettings(previousSettings);
        localSettingsRef.current = previousSettings;
        toast.error(options.errorMessage || getErrorMessage(error) || 'Failed to update settings');
        throw error;
      }
    },
    [instantUpdateMutation, buildChangedPayload],
  );

  const [revealedFields, setRevealedFields] = useState<Record<ApiFieldKey, boolean>>({
    github_personal_access_token: false,
  });

  // persistSettings already surfaces failures via toast, so swallow the rejection here.
  const handlePersistSecret = (field: ApiFieldKey, value: string) => {
    void persistSettings((prev) => ({ ...prev, [field]: value || null })).catch(() => undefined);
  };

  const handlePersistInstructions = (value: string) => {
    void persistSettings((prev) => ({ ...prev, custom_instructions: value || null })).catch(
      () => undefined,
    );
  };

  const toggleFieldVisibility = (field: ApiFieldKey) => {
    setRevealedFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleDeleteAllChats = () => {
    setIsDeleteAllDialogOpen(true);
  };

  const handleNotificationsEnabledChange = (enabled: boolean) => {
    void persistSettings((prev) => ({ ...prev, notifications_enabled: enabled })).catch(
      () => undefined,
    );
  };

  const handleTitleModelChange = (modelId: string) => {
    void persistSettings((prev) => ({ ...prev, title_model_id: modelId })).catch(() => undefined);
  };

  const confirmDeleteAllChats = async () => {
    try {
      await deleteAllChats.mutateAsync();
      toast.success('All chats deleted successfully');
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

  const errorMessage = getErrorMessage(fetchError) ?? null;

  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  }, []);

  if (fetchError && !settings) {
    return (
      <div className={styles['status-screen']}>
        <div className={styles['status-text']}>Failed to load settings</div>
      </div>
    );
  }

  // Covers both first load (no settings yet) and the one render where settings has resolved but the
  // syncing effect hasn't populated localSettings yet.
  if (!settings || !localSettings) {
    return (
      <div className={styles['status-screen']}>
        <Spinner size="lg" className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className={styles.settings}>
      <SettingsSidebarNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onBack={() => navigate('/')}
        userDisplayName={userDisplayName}
        onOpenSettings={() => navigate('/settings')}
        onSignOut={() => logoutMutation.mutate()}
      />

      <div className={styles.main}>
        <SettingsMobileNav
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onBack={() => navigate('/')}
          mobileNavOpen={mobileNavOpen}
          onToggleNav={() => setMobileNavOpen(!mobileNavOpen)}
        />

        {/* Main content area */}
        <div className={styles.content}>
          <div className={styles['content-inner']}>
            {errorMessage && (
              <div className={styles['error-box']}>
                <p className={styles['error-box-text']}>{errorMessage}</p>
              </div>
            )}

            <SettingsProvider
              localSettings={localSettings}
              setLocalSettings={
                setLocalSettings as React.Dispatch<React.SetStateAction<UserSettings>>
              }
              persistSettings={persistSettings}
              settings={settings}
            >
              <ErrorBoundary>
                <div className={styles.panels}>
                  {activeTab === 'general' && (
                    <div role="tabpanel" id="general-panel" aria-labelledby="general-tab">
                      <GeneralSettingsTab
                        fields={generalSecretFields}
                        settings={localSettings}
                        revealedFields={revealedFields}
                        onPersistSecret={handlePersistSecret}
                        onToggleVisibility={toggleFieldVisibility}
                        onDeleteAllChats={handleDeleteAllChats}
                        onNotificationsEnabledChange={handleNotificationsEnabledChange}
                        onTitleModelChange={handleTitleModelChange}
                      />
                    </div>
                  )}

                  {activeTab === 'skills' && (
                    <div role="tabpanel" id="skills-panel" aria-labelledby="skills-tab">
                      <SkillsSettingsTab />
                    </div>
                  )}

                  {activeTab === 'personas' && (
                    <div role="tabpanel" id="personas-panel" aria-labelledby="personas-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <PersonasSettingsTab />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'stream_actions' && (
                    <div
                      role="tabpanel"
                      id="stream_actions-panel"
                      aria-labelledby="stream_actions-tab"
                    >
                      <Suspense fallback={tabLoadingFallback}>
                        <StreamActionsSettingsTab />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'automations' && (
                    <div role="tabpanel" id="automations-panel" aria-labelledby="automations-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <AutomationsSettingsTab />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'env_vars' && (
                    <div role="tabpanel" id="env_vars-panel" aria-labelledby="env_vars-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <EnvVarsSettingsTab />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'instructions' && (
                    <div role="tabpanel" id="instructions-panel" aria-labelledby="instructions-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <InstructionsSettingsTab
                          instructions={localSettings.custom_instructions || ''}
                          onPersist={handlePersistInstructions}
                        />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'cloud' && (
                    <div role="tabpanel" id="cloud-panel" aria-labelledby="cloud-tab">
                      <CloudSettingsTab />
                    </div>
                  )}
                </div>
              </ErrorBoundary>
            </SettingsProvider>
          </div>
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
    </div>
  );
}
