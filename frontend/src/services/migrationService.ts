import { apiClient } from '@/lib/api';

export interface StartupStatus {
  current_version: string;
  previous_version: string | null;
  is_fresh_install: boolean;
  is_upgrade: boolean;
  needs_migration: boolean;
  uses_remote_db: boolean;
  needs_seed: boolean;
  message: string;
  actions: string[];
}

export interface MigrationResult {
  migrations_run: string[];
  seed_completed: boolean;
  errors: string[];
  message: string;
}

class MigrationService {
  async getStartupStatus(): Promise<StartupStatus> {
    const response = await apiClient.get<StartupStatus>('/system/startup-status');
    if (!response) {
      throw new Error('Failed to get startup status');
    }
    return response;
  }

  async runMigrations(): Promise<MigrationResult> {
    const response = await apiClient.post<MigrationResult>('/system/run-migrations');
    if (!response) {
      throw new Error('Failed to run migrations');
    }
    return response;
  }
}

export const migrationService = new MigrationService();
