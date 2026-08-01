import type { ElicitationContent, ElicitationSchema } from '@/types/chat.types';

export interface ElicitationOption {
  value: string;
  title: string;
  description?: string;
}

interface FieldBase {
  key: string;
  label: string;
  description?: string;
  // Per-question free-text companion ("Other:") pulled up beneath its question.
  isCustomAnswer?: boolean;
}

export type ElicitationField =
  | (FieldBase & { kind: 'select' | 'multiselect'; options: ElicitationOption[] })
  | (FieldBase & { kind: 'text' | 'boolean' })
  | (FieldBase & { kind: 'number'; integer: boolean });

// Raw form state: number fields hold their input string until submit.
export type ElicitationValues = Record<string, string | string[] | boolean>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseOptions(raw: unknown): ElicitationOption[] {
  if (!Array.isArray(raw)) return [];
  const options: ElicitationOption[] = [];
  for (const entry of raw) {
    const option = asRecord(entry);
    const value = option && asString(option.const);
    if (!value) continue;
    options.push({
      value,
      title: asString(option.title) ?? value,
      description: asString(option.description),
    });
  }
  return options;
}

// The question this property is the "Other:" box for, when it is one.
function customAnswerTarget(property: Record<string, unknown>): string | undefined {
  const meta = asRecord(property._meta);
  const custom = meta && asRecord(meta._askUserQuestionCustomAnswer);
  return custom ? (asString(custom.questionId) ?? '') : undefined;
}

function parseField(key: string, property: Record<string, unknown>): ElicitationField {
  const label = asString(property.title) ?? key;
  const description = asString(property.description);
  const base = { key, label, description };
  const type = asString(property.type);

  if (type === 'string' && Array.isArray(property.oneOf)) {
    return { ...base, kind: 'select', options: parseOptions(property.oneOf) };
  }
  if (type === 'array') {
    const items = asRecord(property.items);
    return { ...base, kind: 'multiselect', options: parseOptions(items?.anyOf) };
  }
  if (type === 'boolean') {
    return { ...base, kind: 'boolean' };
  }
  if (type === 'number' || type === 'integer') {
    return { ...base, kind: 'number', integer: type === 'integer' };
  }
  // Plain string and anything unrecognized degrade to free text.
  return { ...base, kind: 'text' };
}

// Flatten `requested_schema.properties` into render-ordered fields, moving each
// custom-answer box directly beneath the question it belongs to.
export function parseElicitationSchema(schema: ElicitationSchema | undefined): ElicitationField[] {
  const properties = asRecord(schema?.properties);
  if (!properties) return [];

  const fields: ElicitationField[] = [];
  const customAnswers = new Map<string, ElicitationField[]>();

  for (const [key, raw] of Object.entries(properties)) {
    const property = asRecord(raw) ?? {};
    const target = customAnswerTarget(property);
    if (target === undefined) {
      fields.push(parseField(key, property));
      continue;
    }
    const field: ElicitationField = {
      ...parseField(key, property),
      label: asString(property.title) ?? 'Other',
      isCustomAnswer: true,
    };
    const siblings = customAnswers.get(target) ?? [];
    siblings.push(field);
    customAnswers.set(target, siblings);
  }

  const ordered: ElicitationField[] = [];
  for (const field of fields) {
    ordered.push(field);
    const attached = customAnswers.get(field.key);
    if (attached) {
      ordered.push(...attached);
      customAnswers.delete(field.key);
    }
  }
  // Custom answers naming an unknown question fall back to map order (at the end).
  for (const orphans of customAnswers.values()) {
    ordered.push(...orphans);
  }
  return ordered;
}

// Only what the user actually filled in — empty strings, empty selections and
// unparseable numbers are omitted rather than submitted as blanks.
export function buildElicitationContent(
  fields: ElicitationField[],
  values: ElicitationValues,
): ElicitationContent {
  const content: ElicitationContent = {};

  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined) continue;

    if (field.kind === 'number') {
      if (typeof value !== 'string' || value.trim() === '') continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) continue;
      content[field.key] = parsed;
      continue;
    }
    if (typeof value === 'string') {
      if (value.trim() === '') continue;
      content[field.key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      content[field.key] = value;
      continue;
    }
    content[field.key] = value;
  }

  return content;
}
