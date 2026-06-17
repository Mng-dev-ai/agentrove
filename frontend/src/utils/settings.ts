import {
  DEFAULT_PERSONA,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_THINKING_MODE,
} from '@/store/chatSettingsStore';
import type { CustomEnvVar, Persona, StreamAction } from '@/types/user.types';
import type { GeneralSecretFieldConfig } from '@/types/settings.types';
import { validateRequired, validateUnique } from '@/utils/validation';

export const mergeByName = <T extends { name: string }>(primary: T[], secondary: T[]): T[] => {
  if (!secondary.length) return primary;
  const primaryNames = new Set(primary.map((item) => item.name.toLowerCase()));
  return [...primary, ...secondary.filter((item) => !primaryNames.has(item.name.toLowerCase()))];
};

export const createDefaultEnvVarForm = (): CustomEnvVar => ({
  key: '',
  value: '',
});

export const validateEnvVarForm = (
  form: CustomEnvVar,
  editingIndex: number | null,
  existingItems: CustomEnvVar[],
): string | null => {
  try {
    validateRequired(form.key, 'Environment variable name');
    validateRequired(form.value, 'Environment variable value');
    validateUnique(
      'key',
      form.key,
      existingItems,
      editingIndex,
      'environment variable with this name',
      'An',
      false,
    );

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Validation failed';
  }
};

export const resolvePersona = (storedPersona: string, personas: Persona[]): string =>
  storedPersona !== DEFAULT_PERSONA && personas.some((p) => p.name === storedPersona)
    ? storedPersona
    : DEFAULT_PERSONA;

export const createDefaultPersonaForm = (): Persona => ({
  name: '',
  content: '',
});

export const validatePersonaForm = (
  form: Persona,
  editingIndex: number | null,
  existingItems: Persona[],
): string | null => {
  try {
    validateRequired(form.name, 'Name');
    validateRequired(form.content, 'Content');
    validateUnique('name', form.name, existingItems, editingIndex, 'persona with this name', 'A');

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Validation failed';
  }
};

export const createDefaultStreamActionForm = (): StreamAction => ({
  label: '',
  enabled: true,
  model_id: '',
  command: '',
  persona_name: DEFAULT_PERSONA,
  permission_mode: DEFAULT_PERMISSION_MODE,
  thinking_mode: DEFAULT_THINKING_MODE,
});

export const validateStreamActionForm = (
  form: StreamAction,
  editingIndex: number | null,
  existingItems: StreamAction[],
): string | null => {
  try {
    validateRequired(form.label, 'Label');
    validateRequired(form.model_id, 'Model');
    validateRequired(form.command, 'Command');
    validateUnique(
      'label',
      form.label,
      existingItems,
      editingIndex,
      'action with this label',
      'An',
    );

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Validation failed';
  }
};

export const getGeneralSecretFields = (): GeneralSecretFieldConfig[] => [
  {
    key: 'github_personal_access_token',
    label: 'GitHub Personal Access Token',
    description: 'Required for GitHub integrations and repository access',
    placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
    helperText: {
      prefix: 'Generate a token at',
      anchorText: 'GitHub Settings',
      href: 'https://github.com/settings/tokens',
    },
  },
];
