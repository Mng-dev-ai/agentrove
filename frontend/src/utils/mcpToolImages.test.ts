import { describe, it, expect } from 'vitest';
import { extractToolResultImages } from './mcpToolImages';

const PNG_DATA = 'iVBORw0KGgoAAAANSUhEUg==';

describe('extractToolResultImages', () => {
  it('returns the result untouched when there are no image blocks', () => {
    const result = [{ type: 'text', text: 'hello' }];
    const extracted = extractToolResultImages('t1', result);
    expect(extracted.attachments).toHaveLength(0);
    expect(extracted.remainder).toBe(result);
  });

  it('leaves plain string results untouched', () => {
    const extracted = extractToolResultImages('t1', 'plain output');
    expect(extracted.attachments).toHaveLength(0);
    expect(extracted.remainder).toBe('plain output');
  });

  it('extracts Anthropic-style image blocks from a block array', () => {
    const result = [
      { type: 'text', text: '{"size_bytes": 477357}' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_DATA } },
    ];
    const { attachments, caption, remainder } = extractToolResultImages('tool-1', result);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      id: 'tool-1-image-0',
      file_type: 'image',
      file_url: `data:image/png;base64,${PNG_DATA}`,
      filename: 'screenshot.png',
    });
    expect(caption).toBe('466.2 KB');
    expect(remainder).toBeNull();
  });

  it('turns screenshot size and viewport metadata into a caption', () => {
    const result = [
      {
        type: 'text',
        text: '{"size_bytes":322501,"viewport":{"width":1521,"height":643}}',
      },
      { type: 'image', data: PNG_DATA },
    ];

    expect(extractToolResultImages('t1', result)).toMatchObject({
      caption: '1521 × 643 · 314.9 KB',
      remainder: null,
    });
  });

  it.each([
    ['viewport-only', '{"viewport":{"width":800,"height":600}}', '800 × 600'],
    ['size-only', '{"size_bytes":1024}', '1.0 KB'],
  ])('formats %s screenshot metadata', (_name, text, caption) => {
    const result = [
      { type: 'text', text },
      { type: 'image', data: PNG_DATA },
    ];

    expect(extractToolResultImages('t1', result)).toMatchObject({ caption, remainder: null });
  });

  it.each([
    ['non-metadata text', 'Screenshot complete'],
    ['metadata with extra keys', '{"size_bytes":1024,"url":"https://example.com"}'],
  ])('preserves %s', (_name, text) => {
    const textBlock = { type: 'text', text };
    const result = [textBlock, { type: 'image', data: PNG_DATA }];

    expect(extractToolResultImages('t1', result)).toMatchObject({
      caption: null,
      remainder: [textBlock],
    });
  });

  it('extracts MCP-standard image blocks with mimeType', () => {
    const result = [{ type: 'image', data: PNG_DATA, mimeType: 'image/jpeg' }];
    const { attachments, remainder } = extractToolResultImages('t1', result);

    expect(attachments).toHaveLength(1);
    expect(attachments[0].file_url).toBe(`data:image/jpeg;base64,${PNG_DATA}`);
    expect(attachments[0].filename).toBe('screenshot.jpg');
    expect(remainder).toBeNull();
  });

  it('defaults the media type to image/png', () => {
    const result = [{ type: 'image', data: PNG_DATA }];
    const { attachments } = extractToolResultImages('t1', result);
    expect(attachments[0].file_url).toBe(`data:image/png;base64,${PNG_DATA}`);
  });

  it('extracts image blocks nested in a content array', () => {
    const result = {
      content: [
        { type: 'text', text: 'ok' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_DATA } },
      ],
      isError: false,
    };
    const { attachments, remainder } = extractToolResultImages('t1', result);

    expect(attachments).toHaveLength(1);
    expect(remainder).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false });
  });

  it('drops an emptied content array and nulls an emptied object', () => {
    const { attachments, remainder } = extractToolResultImages('t1', {
      content: [{ type: 'image', data: PNG_DATA }],
    });
    expect(attachments).toHaveLength(1);
    expect(remainder).toBeNull();
  });

  it('handles a bare image block result', () => {
    const { attachments, remainder } = extractToolResultImages('t1', {
      type: 'image',
      data: PNG_DATA,
      mimeType: 'image/png',
    });
    expect(attachments).toHaveLength(1);
    expect(remainder).toBeNull();
  });

  it('numbers filenames when multiple images are present', () => {
    const result = [
      { type: 'image', data: PNG_DATA },
      { type: 'image', data: PNG_DATA },
    ];
    const { attachments } = extractToolResultImages('t1', result);
    expect(attachments.map((a) => a.filename)).toEqual(['screenshot-1.png', 'screenshot-2.png']);
    expect(attachments.map((a) => a.id)).toEqual(['t1-image-0', 't1-image-1']);
  });

  it('ignores image blocks with empty data', () => {
    const result = [{ type: 'image', data: '' }];
    const { attachments, remainder } = extractToolResultImages('t1', result);
    expect(attachments).toHaveLength(0);
    expect(remainder).toBe(result);
  });
});
