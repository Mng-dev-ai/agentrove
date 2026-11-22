import { DEFAULT_PERSONA } from '@/store/chatSettingsStore';
import type { Persona } from '@/types/user.types';

export interface PersonaOption {
  value: string;
  label: string;
}

export const DEFAULT_PERSONA_OPTION: PersonaOption = { value: DEFAULT_PERSONA, label: 'Default' };

export const getPersonaOptions = (personas: Persona[]): PersonaOption[] => [
  DEFAULT_PERSONA_OPTION,
  ...personas.map((p) => ({ value: p.name, label: p.name })),
];

export const getPersonaOption = (value: string, options: readonly PersonaOption[]) =>
  options.find((option) => option.value === value) ?? DEFAULT_PERSONA_OPTION;
