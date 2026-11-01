import { describe, it, expect } from 'vitest';
import { isApiAttachmentUrl, toApiEndpoint, toDownloadUrl } from './attachmentUrl';

describe('isApiAttachmentUrl', () => {
  it('matches relative and absolute URLs under the attachments path', () => {
    expect(isApiAttachmentUrl('/api/v1/attachments/abc.png')).toBe(true);
    expect(isApiAttachmentUrl('https://host/api/v1/attachments/x')).toBe(true);
  });

  it('rejects other API paths, foreign URLs and unparseable input', () => {
    expect(isApiAttachmentUrl('/api/v1/other')).toBe(false);
    expect(isApiAttachmentUrl('https://cdn.example.com/pic.png')).toBe(false);
    expect(isApiAttachmentUrl('http://')).toBe(false);
  });
});

describe('toApiEndpoint', () => {
  it('strips the origin and /api/v1 prefix, preserving the query string', () => {
    expect(toApiEndpoint('/api/v1/attachments/x?token=1')).toBe('/attachments/x?token=1');
    expect(toApiEndpoint('https://host/api/v1/attachments/x?token=1')).toBe(
      '/attachments/x?token=1',
    );
  });

  it('returns the input unchanged when the path is not under /api/v1', () => {
    expect(toApiEndpoint('/other/path')).toBe('/other/path');
  });
});

describe('toDownloadUrl', () => {
  it('rewrites a relative /preview path to /download, keeping the query', () => {
    expect(toDownloadUrl('/api/v1/attachments/x/preview?token=1')).toBe(
      '/api/v1/attachments/x/download?token=1',
    );
  });

  it('rewrites an absolute /preview URL to /download, preserving the origin', () => {
    expect(toDownloadUrl('https://host/api/v1/attachments/x/preview')).toBe(
      'https://host/api/v1/attachments/x/download',
    );
  });

  it('leaves URLs without a /preview suffix untouched', () => {
    expect(toDownloadUrl('/api/v1/attachments/x/download')).toBe('/api/v1/attachments/x/download');
  });
});
