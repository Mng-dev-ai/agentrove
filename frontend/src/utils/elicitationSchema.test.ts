import { describe, expect, it } from 'vitest';
import {
  buildElicitationContent,
  parseElicitationSchema,
  type ElicitationField,
} from './elicitationSchema';

describe('parseElicitationSchema', () => {
  it('returns no fields for a missing or empty schema', () => {
    expect(parseElicitationSchema(undefined)).toEqual([]);
    expect(parseElicitationSchema({ type: 'object' })).toEqual([]);
  });

  it('parses a string with oneOf as a single-select', () => {
    const fields = parseElicitationSchema({
      type: 'object',
      properties: {
        color: {
          type: 'string',
          title: 'Favourite colour',
          description: 'Pick one',
          oneOf: [{ const: 'red', title: 'Red', description: 'Warm' }, { const: 'blue' }],
        },
      },
    });

    expect(fields).toEqual([
      {
        key: 'color',
        kind: 'select',
        label: 'Favourite colour',
        description: 'Pick one',
        options: [
          { value: 'red', title: 'Red', description: 'Warm' },
          { value: 'blue', title: 'blue', description: undefined },
        ],
      },
    ]);
  });

  it('parses an array with items.anyOf as a multi-select', () => {
    const [field] = parseElicitationSchema({
      properties: {
        langs: { type: 'array', items: { anyOf: [{ const: 'ts', title: 'TypeScript' }] } },
      },
    });

    expect(field.kind).toBe('multiselect');
    expect(field.kind === 'multiselect' && field.options).toEqual([
      { value: 'ts', title: 'TypeScript', description: undefined },
    ]);
  });

  it('drops enum options that carry no const value', () => {
    const [field] = parseElicitationSchema({
      properties: { pick: { type: 'string', oneOf: [{ title: 'No value' }, { const: 'ok' }] } },
    });

    expect(field.kind === 'select' && field.options.map((o) => o.value)).toEqual(['ok']);
  });

  it('maps boolean, number and integer properties', () => {
    const fields = parseElicitationSchema({
      properties: {
        agree: { type: 'boolean' },
        ratio: { type: 'number' },
        count: { type: 'integer' },
      },
    });

    expect(fields.map((f) => f.kind)).toEqual(['boolean', 'number', 'number']);
    expect(fields[1].kind === 'number' && fields[1].integer).toBe(false);
    expect(fields[2].kind === 'number' && fields[2].integer).toBe(true);
  });

  it('falls back to a text field for plain strings and unknown shapes', () => {
    const fields = parseElicitationSchema({
      properties: { note: { type: 'string' }, weird: { type: 'quantum' }, broken: 'nonsense' },
    });

    expect(fields.map((f) => f.kind)).toEqual(['text', 'text', 'text']);
    expect(fields.map((f) => f.label)).toEqual(['note', 'weird', 'broken']);
  });

  it('moves a custom-answer field directly beneath the question it belongs to', () => {
    const fields = parseElicitationSchema({
      properties: {
        q1_other: {
          type: 'string',
          _meta: { _askUserQuestionCustomAnswer: { questionId: 'q1' } },
        },
        q0: { type: 'string', oneOf: [{ const: 'a' }] },
        q1: { type: 'string', oneOf: [{ const: 'b' }] },
      },
    });

    expect(fields.map((f) => f.key)).toEqual(['q0', 'q1', 'q1_other']);
    expect(fields[2].isCustomAnswer).toBe(true);
    expect(fields[2].label).toBe('Other');
  });

  it('keeps a custom-answer field in map order when its question is unknown', () => {
    const fields = parseElicitationSchema({
      properties: {
        orphan: {
          type: 'string',
          title: 'Something else',
          _meta: { _askUserQuestionCustomAnswer: { questionId: 'missing' } },
        },
        q0: { type: 'string' },
      },
    });

    expect(fields.map((f) => f.key)).toEqual(['q0', 'orphan']);
    expect(fields[1].label).toBe('Something else');
  });
});

describe('buildElicitationContent', () => {
  const fields: ElicitationField[] = [
    { key: 'pick', kind: 'select', label: 'Pick', options: [] },
    { key: 'many', kind: 'multiselect', label: 'Many', options: [] },
    { key: 'note', kind: 'text', label: 'Note' },
    { key: 'agree', kind: 'boolean', label: 'Agree' },
    { key: 'count', kind: 'number', label: 'Count', integer: true },
  ];

  it('omits untouched fields', () => {
    expect(buildElicitationContent(fields, {})).toEqual({});
  });

  it('omits empty strings, blank text and empty selections', () => {
    expect(buildElicitationContent(fields, { pick: '', many: [], note: '   ', count: '' })).toEqual(
      {},
    );
  });

  it('keeps filled values and coerces numbers', () => {
    expect(
      buildElicitationContent(fields, {
        pick: 'a',
        many: ['a', 'b'],
        note: 'hello',
        agree: false,
        count: '42',
      }),
    ).toEqual({ pick: 'a', many: ['a', 'b'], note: 'hello', agree: false, count: 42 });
  });

  it('omits numbers that do not parse', () => {
    expect(buildElicitationContent(fields, { count: 'abc' })).toEqual({});
  });

  it('ignores values for keys that are not fields', () => {
    expect(buildElicitationContent(fields, { ghost: 'boo' })).toEqual({});
  });
});
