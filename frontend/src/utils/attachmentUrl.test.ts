import { describe, it, expect } from 'vitest';
import {
  isApiAttachmentUrl,
  toApiEndpoint,
  toDownloadUrl,
  isBrowserObjectUrl,
} from './attachmentUrl';

describe('isApiAttachmentUrl', () => {
  it('matches a relative attachments path', () => {
    expect(isApiAttachmentUrl('/api/v1/attachments/abc.png')).toBe(true);
    expect(isApiAttachmentUrl('/api/v1/attachments/')).toBe(true);
  });

  it('matches an absolute URL whose path is under attachments', () => {
    expect(isApiAttachmentUrl('https://host/api/v1/attachments/x')).toBe(true);
  });

  it('rejects other API paths and non-attachment URLs', () => {
    expect(isApiAttachmentUrl('/api/v1/other')).toBe(false);
    expect(isApiAttachmentUrl('https://cdn.example.com/pic.png')).toBe(false);
  });

  it('returns false for an unparseable URL', () => {
    // 'http://' has no host, so the URL constructor throws and parseUrl yields null.
    expect(isApiAttachmentUrl('http://')).toBe(false);
  });
});

describe('toApiEndpoint', () => {
  it('strips the /api/v1 prefix and preserves the query string', () => {
    expect(toApiEndpoint('/api/v1/attachments/x?token=1')).toBe('/attachments/x?token=1');
  });

  it('drops the origin of an absolute API URL, keeping only the endpoint path', () => {
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

describe('isBrowserObjectUrl', () => {
  it('matches blob: and data: URLs', () => {
    expect(isBrowserObjectUrl('blob:https://host/uuid')).toBe(true);
    expect(isBrowserObjectUrl('data:image/png;base64,AAAA')).toBe(true);
  });

  it('rejects http and API URLs', () => {
    expect(isBrowserObjectUrl('https://host/x.png')).toBe(false);
    expect(isBrowserObjectUrl('/api/v1/attachments/x')).toBe(false);
  });
});
