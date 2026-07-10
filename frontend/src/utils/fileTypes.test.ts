import { describe, it, expect } from 'vitest';
import {
  isUploadedImageFile,
  isUploadedPdfFile,
  isUploadedXlsxFile,
  isSupportedUploadedFile,
  isMarkdownFile,
  isCsvFile,
  isXlsxFile,
  isImageFile,
  isHtmlFile,
  isPowerPointFile,
  isPdfFile,
  isPreviewableFile,
  isImageUrl,
  detectFileType,
} from './fileTypes';
import type { FileStructure } from '@/types/file-system.types';

// checkMimeType only reads name/type, so a bare object stands in for a File.
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

  it('rejects svg — not in the allowed mime list and no extension fallback here', () => {
    expect(isUploadedImageFile(file('logo.svg', 'image/svg+xml'))).toBe(false);
  });

  it('rejects a png known only by extension (image check has no extension fallback)', () => {
    expect(isUploadedImageFile(file('a.png', ''))).toBe(false);
  });
});

describe('isUploadedPdfFile', () => {
  it('accepts by mime type', () => {
    expect(isUploadedPdfFile(file('a.pdf', 'application/pdf'))).toBe(true);
  });

  it('accepts by extension when the mime is missing', () => {
    expect(isUploadedPdfFile(file('a.PDF', ''))).toBe(true);
  });

  it('rejects unrelated files', () => {
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

  it('rejects a legacy .xls (only .xlsx is the extension fallback here)', () => {
    expect(isUploadedXlsxFile(file('a.xls', 'application/vnd.ms-excel'))).toBe(false);
  });
});

describe('isSupportedUploadedFile', () => {
  it('is true for supported image/pdf/xlsx uploads', () => {
    expect(isSupportedUploadedFile(file('a.png', 'image/png'))).toBe(true);
    expect(isSupportedUploadedFile(file('a.pdf', 'application/pdf'))).toBe(true);
    expect(isSupportedUploadedFile(file('a.xlsx', ''))).toBe(true);
  });

  it('is false for an unsupported type', () => {
    expect(isSupportedUploadedFile(file('a.txt', 'text/plain'))).toBe(false);
  });
});

describe('FileStructure type predicates', () => {
  it('detects markdown by .md and .markdown', () => {
    expect(isMarkdownFile(node('docs/readme.md'))).toBe(true);
    expect(isMarkdownFile(node('docs/notes.markdown'))).toBe(true);
  });

  it('matches extensions case-insensitively', () => {
    expect(isImageFile(node('pics/A.PNG'))).toBe(true);
  });

  it('detects csv, xlsx, html, powerpoint and pdf', () => {
    expect(isCsvFile(node('data.csv'))).toBe(true);
    expect(isXlsxFile(node('sheet.xls'))).toBe(true);
    expect(isHtmlFile(node('page.htm'))).toBe(true);
    expect(isPowerPointFile(node('deck.pptx'))).toBe(true);
    expect(isPdfFile(node('doc.pdf'))).toBe(true);
  });

  it('returns false for null, folders, and unknown extensions', () => {
    expect(isMarkdownFile(null)).toBe(false);
    expect(isImageFile(node('assets', 'folder'))).toBe(false);
    expect(isPdfFile(node('script.ts'))).toBe(false);
  });
});

describe('isPreviewableFile', () => {
  it('is true for any previewable kind and false otherwise', () => {
    expect(isPreviewableFile(node('a.md'))).toBe(true);
    expect(isPreviewableFile(node('a.png'))).toBe(true);
    expect(isPreviewableFile(node('a.ts'))).toBe(false);
    expect(isPreviewableFile(null)).toBe(false);
  });
});

describe('isImageUrl', () => {
  it('matches known image extensions case-insensitively', () => {
    expect(isImageUrl('https://host/a.PNG')).toBe(true);
    expect(isImageUrl('logo.svg')).toBe(true);
  });

  it('rejects non-image URLs', () => {
    expect(isImageUrl('https://host/a.txt')).toBe(false);
  });
});

describe('detectFileType', () => {
  it('classifies pdf by mime or extension', () => {
    expect(detectFileType('report.pdf')).toBe('pdf');
    expect(detectFileType('nameless', 'application/pdf')).toBe('pdf');
  });

  it('classifies images by mime or extension', () => {
    expect(detectFileType('photo.JPG')).toBe('image');
    expect(detectFileType('nameless', 'image/png')).toBe('image');
  });

  it('classifies xlsx/xls including the legacy excel mime', () => {
    expect(detectFileType('data.xlsx')).toBe('xlsx');
    expect(detectFileType('old.xls')).toBe('xlsx');
    expect(detectFileType('nameless', 'application/vnd.ms-excel')).toBe('xlsx');
  });

  it('throws for unsupported types', () => {
    expect(() => detectFileType('notes.txt')).toThrow('Unsupported file type: notes.txt');
  });
});
