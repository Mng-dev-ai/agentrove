export interface User {
  id: string;
  email: string;
  username: string;
  is_verified: boolean;
  email_verification_required: boolean;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface DesktopLocalSessionResponse extends AuthResponse {
  mode: 'desktop-local';
  user: User;
}

export interface CustomEnvVar {
  key: string;
  value: string;
  [key: string]: unknown;
}

export interface CustomSkill {
  name: string;
  description: string;
  size_bytes: number;
  file_count: number;
  source: string;
  read_only: boolean;
}

export interface Persona {
  name: string;
  content: string;
}

export type SandboxProviderType = 'docker' | 'host';

export interface UserSettings {
  id: string;
  user_id: string;
  github_personal_access_token: string | null;
  custom_instructions: string | null;
  custom_env_vars: CustomEnvVar[] | null;
  personas: Persona[] | null;
  notifications_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type UserSettingsUpdate = Partial<
  Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>
>;
