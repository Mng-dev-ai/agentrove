import { describe, it, expect } from 'vitest';
import {
  mergeByName,
  createDefaultEnvVarForm,
  validateEnvVarForm,
  resolvePersona,
  createDefaultPersonaForm,
  validatePersonaForm,
  createDefaultStreamActionForm,
  validateStreamActionForm,
  getGeneralSecretFields,
} from './settings';
import type { CustomEnvVar, Persona, StreamAction } from '@/types/user.types';

describe('mergeByName', () => {
  it('returns primary unchanged when secondary is empty', () => {
    const primary = [{ name: 'a' }];
    expect(mergeByName(primary, [])).toBe(primary);
  });

  it('appends only secondary items whose names are not already present (case-insensitive)', () => {
    const merged = mergeByName([{ name: 'Alpha' }], [{ name: 'alpha' }, { name: 'Beta' }]);
    expect(merged.map((i) => i.name)).toEqual(['Alpha', 'Beta']);
  });
});

describe('validateEnvVarForm', () => {
  const form = (over: Partial<CustomEnvVar> = {}): CustomEnvVar => ({
    key: 'KEY',
    value: 'val',
    ...over,
  });

  it('returns null for a valid, unique form', () => {
    expect(validateEnvVarForm(form(), null, [])).toBeNull();
  });

  it('requires a key', () => {
    expect(validateEnvVarForm(form({ key: '  ' }), null, [])).toBe(
      'Environment variable name is required',
    );
  });

  it('requires a value', () => {
    expect(validateEnvVarForm(form({ value: '' }), null, [])).toBe(
      'Environment variable value is required',
    );
  });

  it('rejects a duplicate key case-sensitively', () => {
    const existing = [form({ key: 'KEY' })];
    expect(validateEnvVarForm(form({ key: 'KEY' }), null, existing)).toBe(
      'An environment variable with this name already exists',
    );
    // Env var names are case-sensitive, so a differently-cased key is allowed.
    expect(validateEnvVarForm(form({ key: 'key' }), null, existing)).toBeNull();
  });

  it('ignores the row being edited when checking uniqueness', () => {
    const existing = [form({ key: 'KEY' })];
    expect(validateEnvVarForm(form({ key: 'KEY' }), 0, existing)).toBeNull();
  });
});

describe('resolvePersona', () => {
  const personas: Persona[] = [{ name: 'Reviewer', content: '' }];

  it('keeps a non-default persona that exists', () => {
    expect(resolvePersona('Reviewer', personas)).toBe('Reviewer');
  });

  it('falls back to Default for an unknown persona', () => {
    expect(resolvePersona('Ghost', personas)).toBe('Default');
  });

  it('passes Default through untouched', () => {
    expect(resolvePersona('Default', personas)).toBe('Default');
  });
});

describe('validatePersonaForm', () => {
  const form = (over: Partial<Persona> = {}): Persona => ({ name: 'P', content: 'c', ...over });

  it('returns null for a valid form', () => {
    expect(validatePersonaForm(form(), null, [])).toBeNull();
  });

  it('requires a name and content', () => {
    expect(validatePersonaForm(form({ name: '' }), null, [])).toBe('Name is required');
    expect(validatePersonaForm(form({ content: '' }), null, [])).toBe('Content is required');
  });

  it('rejects a duplicate name case-insensitively', () => {
    const existing = [form({ name: 'Reviewer' })];
    expect(validatePersonaForm(form({ name: 'reviewer' }), null, existing)).toBe(
      'A persona with this name already exists',
    );
  });
});

describe('validateStreamActionForm', () => {
  const form = (over: Partial<StreamAction> = {}): StreamAction => ({
    ...createDefaultStreamActionForm(),
    label: 'Run',
    model_id: 'm1',
    command: 'do it',
    ...over,
  });

  it('returns null for a valid form', () => {
    expect(validateStreamActionForm(form(), null, [])).toBeNull();
  });

  it('requires label, model, and command', () => {
    expect(validateStreamActionForm(form({ label: '' }), null, [])).toBe('Label is required');
    expect(validateStreamActionForm(form({ model_id: '' }), null, [])).toBe('Model is required');
    expect(validateStreamActionForm(form({ command: '' }), null, [])).toBe('Command is required');
  });

  it('rejects a duplicate label', () => {
    const existing = [form({ label: 'Run' })];
    expect(validateStreamActionForm(form({ label: 'run' }), null, existing)).toBe(
      'An action with this label already exists',
    );
  });
});

describe('form factories and static config', () => {
  it('creates empty env var and persona forms', () => {
    expect(createDefaultEnvVarForm()).toEqual({ key: '', value: '' });
    expect(createDefaultPersonaForm()).toEqual({ name: '', content: '' });
  });

  it('seeds a stream action form with the shared defaults', () => {
    expect(createDefaultStreamActionForm()).toMatchObject({
      label: '',
      enabled: true,
      persona_name: 'Default',
      permission_mode: 'bypassPermissions',
      thinking_mode: 'high',
    });
  });

  it('exposes the GitHub PAT secret field', () => {
    const fields = getGeneralSecretFields();
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe('github_personal_access_token');
  });
});
