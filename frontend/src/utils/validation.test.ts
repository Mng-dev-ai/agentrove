import { describe, it, expect } from 'vitest';
import {
  isValidEmail,
  isValidUsername,
  isValidPassword,
  validateRequired,
  validateUnique,
  validateId,
} from './validation';
import { ValidationError } from '@/services/base/ServiceError';

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('user.name+tag@sub.example.com')).toBe(true);
  });

  it('rejects addresses without an @ or a valid TLD', () => {
    expect(isValidEmail('no-at')).toBe(false);
    expect(isValidEmail('a@b.c')).toBe(false); // single-char TLD
    expect(isValidEmail('@b.co')).toBe(false);
    expect(isValidEmail('a b@c.co')).toBe(false); // whitespace
    expect(isValidEmail('')).toBe(false);
  });
});

describe('isValidUsername', () => {
  it('accepts alphanumeric/underscore names of length 3-30', () => {
    expect(isValidUsername('abc')).toBe(true);
    expect(isValidUsername('a_b')).toBe(true);
    expect(isValidUsername('ABC123')).toBe(true);
    expect(isValidUsername('a'.repeat(30))).toBe(true);
  });

  it('rejects out-of-range lengths', () => {
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('a'.repeat(31))).toBe(false);
  });

  it('rejects illegal characters', () => {
    expect(isValidUsername('a-b')).toBe(false);
    expect(isValidUsername('a b')).toBe(false);
  });

  it('rejects leading or trailing underscores', () => {
    expect(isValidUsername('_abc')).toBe(false);
    expect(isValidUsername('abc_')).toBe(false);
  });
});

describe('isValidPassword', () => {
  it('enforces the default 8-char minimum', () => {
    expect(isValidPassword('1234567')).toBe(false);
    expect(isValidPassword('12345678')).toBe(true);
  });

  it('honors a custom minimum length', () => {
    expect(isValidPassword('abc', 3)).toBe(true);
    expect(isValidPassword('ab', 3)).toBe(false);
  });
});

describe('validateRequired', () => {
  it('throws for null, undefined and blank strings', () => {
    expect(() => validateRequired(null, 'Name')).toThrow(ValidationError);
    expect(() => validateRequired(undefined, 'Name')).toThrow('Name is required');
    expect(() => validateRequired('   ', 'Name')).toThrow('Name is required');
  });

  it('passes for non-empty values, including falsy non-strings', () => {
    expect(() => validateRequired('x', 'Name')).not.toThrow();
    expect(() => validateRequired(0, 'Count')).not.toThrow();
    expect(() => validateRequired(false, 'Flag')).not.toThrow();
  });
});

describe('validateUnique', () => {
  const items = [{ name: 'Alpha' }, { name: 'Beta' }];

  it('throws with the article + display name when a duplicate exists', () => {
    expect(() => validateUnique('name', 'Alpha', items, null, 'agent', 'An')).toThrow(
      'An agent already exists',
    );
  });

  it('is case-insensitive by default', () => {
    expect(() => validateUnique('name', 'alpha', items, null, 'agent', 'An')).toThrow(
      ValidationError,
    );
  });

  it('respects case when caseInsensitive is false', () => {
    expect(() => validateUnique('name', 'alpha', items, null, 'agent', 'An', false)).not.toThrow();
  });

  it('skips the row being edited', () => {
    expect(() => validateUnique('name', 'Alpha', items, 0, 'agent', 'An')).not.toThrow();
  });

  it('passes when no duplicate is found', () => {
    expect(() => validateUnique('name', 'Gamma', items, null, 'agent', 'An')).not.toThrow();
  });
});

describe('validateId', () => {
  it('throws when the id is missing', () => {
    expect(() => validateId(null)).toThrow('ID is required');
    expect(() => validateId('')).toThrow('ID is required');
  });

  it('throws when the id is not a string', () => {
    expect(() => validateId(123)).toThrow('ID must be a string');
  });

  it('uses a custom field name', () => {
    expect(() => validateId(123, 'Chat ID')).toThrow('Chat ID must be a string');
  });

  it('passes for a non-empty string id', () => {
    expect(() => validateId('abc')).not.toThrow();
  });
});
