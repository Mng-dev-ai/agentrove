import { describe, it, expect } from 'vitest';
import {
  isUploadedImageFile,
  isUploadedPdfFile,
  isUploadedXlsxFile,
  isImageFile,
  isPreviewableFile,
  isImageUrl,
  detectFileType,
} from './fileTypes';
import type { FileStructure } from '@/types/file-system.types';

const file = (name: string, type: string): File => ({ name, type }) as unknown as File;

const node = (path: string, type: FileStructure['type'] = 'file'): FileStructure => ({
  path,
  type,
  content: '',
});

describe('isUploadedImageFile', () => {
  it('accepts the backend-allowed image mime types', () => {
    expect(isUploadedImageFile(file('a.png', 'image/png'))).toBe(true);
    expect(isUploadedImageFile(file('a.webp', 'image/webp'))).toBe(true);
  });

  it('rejects svg and images known only by extension', () => {
    expect(isUploadedImageFile(file('logo.svg', 'image/svg+xml'))).toBe(false);
    expect(isUploadedImageFile(file('a.png', ''))).toBe(false);
  });
});

describe('isUploadedPdfFile', () => {
  it('accepts by mime type or by extension when the mime is missing', () => {
    expect(isUploadedPdfFile(file('a.pdf', 'application/pdf'))).toBe(true);
    expect(isUploadedPdfFile(file('a.PDF', ''))).toBe(true);
    expect(isUploadedPdfFile(file('a.txt', 'text/plain'))).toBe(false);
  });
});

describe('isUploadedXlsxFile', () => {
  it('accepts by mime type and by .xlsx extension', () => {
    expect(
      isUploadedXlsxFile(
        file('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      ),
    ).toBe(true);
    expect(isUploadedXlsxFile(file('a.xlsx', ''))).toBe(true);
  });

  it('rejects a legacy .xls upload', () => {
    expect(isUploadedXlsxFile(file('a.xls', 'application/vnd.ms-excel'))).toBe(false);
  });
});

describe('FileStructure predicates', () => {
  it('match extensions case-insensitively', () => {
    expect(isImageFile(node('pics/A.PNG'))).toBe(true);
  });

  it('treat any previewable kind as previewable and reject null, folders and code', () => {
    expect(isPreviewableFile(node('a.md'))).toBe(true);
    expect(isPreviewableFile(node('deck.pptx'))).toBe(true);
    expect(isPreviewableFile(node('a.ts'))).toBe(false);
    expect(isPreviewableFile(node('docs.md', 'folder'))).toBe(false);
    expect(isPreviewableFile(null)).toBe(false);
  });
});

describe('isImageUrl', () => {
  it('matches image extensions case-insensitively', () => {
    expect(isImageUrl('https://host/a.PNG')).toBe(true);
    expect(isImageUrl('https://host/a.txt')).toBe(false);
  });
});

describe('detectFileType', () => {
  it.each([
    ['report.pdf', undefined, 'pdf'],
    ['nameless', 'application/pdf', 'pdf'],
    ['photo.JPG', undefined, 'image'],
    ['nameless', 'image/png', 'image'],
    ['data.xlsx', undefined, 'xlsx'],
    ['old.xls', undefined, 'xlsx'],
    ['nameless', 'application/vnd.ms-excel', 'xlsx'],
  ])('classifies %j (%s) as %s', (name, mime, expected) => {
    expect(detectFileType(name, mime)).toBe(expected);
  });

  it('throws for unsupported types', () => {
    expect(() => detectFileType('notes.txt')).toThrow('Unsupported file type: notes.txt');
  });
});
