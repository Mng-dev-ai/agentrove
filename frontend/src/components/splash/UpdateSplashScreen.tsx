import { useEffect, useState } from 'react';
import { Loader2, Database, Settings, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/utils/cn';
import { migrationService, type StartupStatus, type MigrationResult } from '@/services/migrationService';

interface UpdateSplashScreenProps {
  onComplete: () => void;
}

interface TaskItem {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export function UpdateSplashScreen({ onComplete }: UpdateSplashScreenProps) {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [currentMessage, setCurrentMessage] = useState('Checking for updates...');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const runStartupChecks = async () => {
      try {
        // Get startup status
        const startupStatus = await migrationService.getStartupStatus();
        setStatus(startupStatus);

        // Determine tasks based on status
        const taskList: TaskItem[] = [];

        if (startupStatus.is_upgrade) {
          taskList.push({
            id: 'migrations',
            label: `Upgrading from v${startupStatus.previous_version} to v${startupStatus.current_version}`,
            status: 'pending',
          });
        }

        if (startupStatus.needs_seed) {
          taskList.push({
            id: 'seed',
            label: 'Setting up local database',
            status: 'pending',
          });
        }

        if (startupStatus.uses_remote_db) {
          taskList.push({
            id: 'remote_db',
            label: 'Connecting to remote database',
            status: 'pending',
          });
        }

        if (taskList.length === 0) {
          // No tasks needed, proceed immediately
          onComplete();
          return;
        }

        setTasks(taskList);

        // Run migrations if needed
        if (startupStatus.needs_migration || startupStatus.needs_seed) {
          setCurrentMessage('Running updates...');

          // Mark first task as running
          setTasks((prev) =>
            prev.map((t, i) => (i === 0 ? { ...t, status: 'running' } : t))
          );

          const result = await migrationService.runMigrations();

          // Update task statuses based on result
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id === 'migrations' && result.migrations_run.includes('first_user_set_as_admin')) {
                return { ...t, status: 'completed' };
              }
              if (t.id === 'seed' && result.seed_completed) {
                return { ...t, status: 'completed' };
              }
              if (result.errors.length > 0) {
                return { ...t, status: 'error' };
              }
              return { ...t, status: 'completed' };
            })
          );

          if (result.errors.length > 0) {
            setHasError(true);
            setCurrentMessage('Update completed with warnings');
          } else {
            setCurrentMessage('Updates completed successfully');
          }
        } else {
          // Just connecting to remote DB
          setTasks((prev) =>
            prev.map((t) => ({ ...t, status: 'completed' }))
          );
          setCurrentMessage('Connected to remote database');
        }

        // Wait a moment to show completion, then proceed
        setTimeout(() => {
          onComplete();
        }, 1500);
      } catch (error) {
        console.error('Startup check failed:', error);
        setHasError(true);
        setCurrentMessage('Failed to check for updates. Please try again.');

        // Still proceed after error
        setTimeout(() => {
          onComplete();
        }, 3000);
      }
    };

    runStartupChecks();
  }, [onComplete]);

  if (!status || tasks.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface dark:bg-surface-dark">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-text-tertiary dark:text-text-dark-tertiary" />
          <p className="text-sm text-text-secondary dark:text-text-dark-secondary">
            {currentMessage}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface dark:bg-surface-dark">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-secondary p-8 shadow-xl dark:border-border-dark dark:bg-surface-dark-secondary">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-tertiary dark:bg-surface-dark-tertiary">
            {hasError ? (
              <AlertCircle className="h-6 w-6 text-text-tertiary dark:text-text-dark-tertiary" />
            ) : (
              <Settings className="h-6 w-6 text-text-tertiary dark:text-text-dark-tertiary" />
            )}
          </div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-text-dark-primary">
            {hasError ? 'Update Notice' : 'Updating Application'}
          </h2>
          <p className="mt-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            {currentMessage}
          </p>
        </div>

        {/* Task List */}
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border px-4 py-3 dark:border-border-dark',
                task.status === 'running' && 'border-border-hover dark:border-border-dark-hover',
                task.status === 'completed' && 'border-border dark:border-border-dark',
                task.status === 'error' && 'border-red-500/50'
              )}
            >
              <div className="flex-shrink-0">
                {task.status === 'pending' && (
                  <div className="h-5 w-5 rounded-full border-2 border-border dark:border-border-dark" />
                )}
                {task.status === 'running' && (
                  <Loader2 className="h-5 w-5 animate-spin text-text-tertiary dark:text-text-dark-tertiary" />
                )}
                {task.status === 'completed' && (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                {task.status === 'error' && (
                  <AlertCircle className="h-5 w-5 text-red-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-text-secondary dark:text-text-dark-secondary">
                  {task.label}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Info Box */}
        {status.is_fresh_install && !status.uses_remote_db && (
          <div className="mt-6 rounded-lg border border-border bg-surface-tertiary p-4 dark:border-border-dark dark:bg-surface-dark-tertiary">
            <div className="flex items-start gap-3">
              <Database className="h-4 w-4 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
              <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                Setting up your local database. This may take a moment. Your data will be stored locally on this device.
              </p>
            </div>
          </div>
        )}

        {status.uses_remote_db && (
          <div className="mt-6 rounded-lg border border-border bg-surface-tertiary p-4 dark:border-border-dark dark:bg-surface-dark-tertiary">
            <div className="flex items-start gap-3">
              <Database className="h-4 w-4 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
              <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                Connected to cloud database. Your settings and data will be synced across devices.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
