import { apiClient } from '@/lib/api';

export interface SystemStatus {
  has_master_password: boolean;
  remote_db_enabled: boolean;
  has_remote_db_url: boolean;
  instance_name: string | null;
  is_web_master: boolean;
  allow_remote_connections: boolean;
}

export interface MasterPasswordRequest {
  password: string;
}

export interface RemoteDbConfigRequest {
  db_url: string;
  enabled: boolean;
  master_password?: string;
}

export interface InstanceConfigRequest {
  instance_name?: string;
  is_web_master: boolean;
  allow_remote_connections: boolean;
}

class SystemService {
  async getStatus(): Promise<SystemStatus> {
    const response = await apiClient.get<SystemStatus>('/system/status');
    return response.data;
  }

  async setMasterPassword(data: MasterPasswordRequest): Promise<void> {
    await apiClient.post('/system/master-password', data);
  }

  async verifyMasterPassword(password: string): Promise<boolean> {
    try {
      await apiClient.post('/system/master-password/verify', { password });
      return true;
    } catch {
      return false;
    }
  }

  async configureRemoteDb(data: RemoteDbConfigRequest): Promise<void> {
    await apiClient.post('/system/remote-db', data);
  }

  async disableRemoteDb(): Promise<void> {
    await apiClient.delete('/system/remote-db');
  }

  async configureInstance(data: InstanceConfigRequest): Promise<void> {
    await apiClient.post('/system/instance', data);
  }
}

export const systemService = new SystemService();
