export interface User {
  id: string;
  email: string;
  username: string;
  is_verified: boolean;
  email_verification_required: boolean;
  daily_message_limit: number | null;
}

export interface UserUsage {
  messages_used_today: number;
  daily_message_limit: number | null;
  messages_remaining: number;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface CustomAgent {
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit' | null;
  allowed_tools?: string[] | null;
  [key: string]: unknown;
}

export interface CustomMcp {
  name: string;
  description: string;
  command_type: 'npx' | 'bunx' | 'uvx' | 'http';
  package?: string;
  url?: string;
  env_vars?: Record<string, string>;
  args?: string[];
  enabled: boolean;
  [key: string]: unknown;
}

export interface CustomEnvVar {
  key: string;
  value: string;
  [key: string]: unknown;
}

export interface CustomSkill {
  name: string;
  description: string;
  enabled: boolean;
  size_bytes: number;
  file_count: number;
}

export interface CustomCommand {
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  argument_hint?: string | null;
  allowed_tools?: string[] | null;
  model?:
    | 'claude-sonnet-4-5-20250929'
    | 'claude-opus-4-5-20251101'
    | 'claude-haiku-4-5-20251001'
    | null;
}

export interface CustomPrompt {
  name: string;
  content: string;
}

export type SandboxProviderType = 'docker' | 'e2b' | 'modal';

export type ProviderType = 'anthropic' | 'openrouter' | 'openai' | 'custom';

export interface CustomProviderModel {
  model_id: string;
  name: string;
  enabled: boolean;
}

export interface CustomProvider {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string | null;
  auth_token: string | null;
  enabled: boolean;
  models: CustomProviderModel[];
}

export interface UserSettings {
  id: string;
  user_id: string;
  github_personal_access_token: string | null;
  e2b_api_key: string | null;
  modal_api_key: string | null;
  sandbox_provider: SandboxProviderType | null;
  custom_instructions: string | null;
  custom_providers: CustomProvider[] | null;
  custom_agents: CustomAgent[] | null;
  custom_mcps: CustomMcp[] | null;
  custom_env_vars: CustomEnvVar[] | null;
  custom_skills: CustomSkill[] | null;
  custom_slash_commands: CustomCommand[] | null;
  custom_prompts: CustomPrompt[] | null;
  notification_sound_enabled?: boolean;
  auto_compact_disabled?: boolean;
  attribution_disabled?: boolean;
  created_at: string;
  updated_at: string;
}

export type UserSettingsUpdate = Partial<
  Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>
>;
