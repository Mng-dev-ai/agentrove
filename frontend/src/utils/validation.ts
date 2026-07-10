import { ValidationError } from '@/services/base/ServiceError';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

const checkDuplicate = <T extends object>(
  field: keyof T,
  value: string,
  items: T[],
  editingIndex: number | null,
  caseInsensitive: boolean,
): boolean => {
  const normalizedValue = caseInsensitive ? value.toLowerCase() : value;

  return items.some((item, index) => {
    if (editingIndex !== null && index === editingIndex) {
      return false;
    }

    const itemValue = item[field];
    if (typeof itemValue !== 'string') {
      return false;
    }

    const normalizedItem = caseInsensitive ? itemValue.toLowerCase() : itemValue;
    return normalizedItem === normalizedValue;
  });
};

export const isValidEmail = (email: string): boolean => {
  return EMAIL_REGEX.test(email);
};

export const isValidUsername = (username: string): boolean => {
  return (
    username.length >= 3 &&
    username.length <= 30 &&
    USERNAME_REGEX.test(username) &&
    !username.startsWith('_') &&
    !username.endsWith('_')
  );
};

export const isValidPassword = (password: string, minLength = 8): boolean => {
  return password.length >= minLength;
};

export function validateRequired(value: unknown, fieldName: string): void {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    throw new ValidationError(`${fieldName} is required`);
  }
}

export function validateUnique<T extends object>(
  field: keyof T,
  value: string,
  items: T[],
  editingIndex: number | null,
  displayName: string,
  article: 'A' | 'An',
  caseInsensitive: boolean = true,
): void {
  const isDuplicate = checkDuplicate(field, value, items, editingIndex, caseInsensitive);

  if (isDuplicate) {
    throw new ValidationError(`${article} ${displayName} already exists`);
  }
}

export const validateId = (id: unknown, fieldName: string = 'ID'): void => {
  validateRequired(id, fieldName);

  if (typeof id !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`);
  }
};
