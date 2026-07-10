// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import toast from 'react-hot-toast';
import {
  sortFiles,
  getFileName,
  getAncestorFolderPaths,
  findFileInStructure,
  findFileByToolPath,
  detectLanguage,
  filterChatAttachmentFiles,
  buildFileStructureFromSandboxFiles,
  hasActualFiles,
  traverseFileStructure,
  fetchAttachmentBlob,
  downloadAttachmentFile,
  convertDataUrlToUploadedFile,
} from './file';
import type { FileStructure } from '@/types/file-system.types';
import type { FileMetadata } from '@/types/sandbox.types';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const fileNode = (path: string): FileStructure => ({ path, type: 'file', content: '' });
const folderNode = (path: string, children: FileStructure[]): FileStructure => ({
  path,
  type: 'folder',
  content: '',
  children,
});

// filterChatAttachmentFiles reads name/size/type only.
const upload = (name: string, type: string, size: number): File =>
  ({ name, type, size }) as unknown as File;

describe('sortFiles', () => {
  it('places folders before files and sorts each group by path', () => {
    const sorted = sortFiles([fileNode('zeta.md'), fileNode('alpha.md'), folderNode('src', [])]);
    expect(sorted.map((f) => f.path)).toEqual(['src', 'alpha.md', 'zeta.md']);
  });

  it('recurses into folder children', () => {
    const sorted = sortFiles([folderNode('src', [fileNode('src/b.ts'), fileNode('src/a.ts')])]);
    expect(sorted[0].children?.map((c) => c.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('getFileName', () => {
  it('returns the last path segment', () => {
    expect(getFileName('a/b/c.ts')).toBe('c.ts');
    expect(getFileName('single')).toBe('single');
  });
});

describe('getAncestorFolderPaths', () => {
  it('returns each cumulative ancestor folder, excluding the file itself', () => {
    expect(getAncestorFolderPaths('a/b/c/file.ts')).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('returns an empty array for a root-level file', () => {
    expect(getAncestorFolderPaths('file.ts')).toEqual([]);
  });
});

describe('findFileInStructure', () => {
  const tree = [folderNode('src', [fileNode('src/a.ts')]), fileNode('root.ts')];

  it('finds nested and top-level entries by exact path', () => {
    expect(findFileInStructure(tree, 'src/a.ts')?.path).toBe('src/a.ts');
    expect(findFileInStructure(tree, 'root.ts')?.path).toBe('root.ts');
  });

  it('returns undefined for an unknown path', () => {
    expect(findFileInStructure(tree, 'nope.ts')).toBeUndefined();
  });
});

describe('findFileByToolPath', () => {
  const tree = [folderNode('src', [fileNode('src/foo.ts')])];

  it('matches an absolute tool path by stripping leading segments', () => {
    expect(findFileByToolPath(tree, '/home/user/project/src/foo.ts')?.path).toBe('src/foo.ts');
  });

  it('matches an already-relative path directly', () => {
    expect(findFileByToolPath(tree, 'src/foo.ts')?.path).toBe('src/foo.ts');
  });

  it('returns undefined for a relative path with no match', () => {
    expect(findFileByToolPath(tree, 'other/foo.ts')).toBeUndefined();
  });
});

describe('detectLanguage', () => {
  it('maps known extensions case-insensitively', () => {
    expect(detectLanguage('a.ts')).toBe('typescript');
    expect(detectLanguage('a.PY')).toBe('python');
  });

  it('falls back to plaintext for unknown extensions', () => {
    expect(detectLanguage('a.unknownext')).toBe('plaintext');
    expect(detectLanguage('Makefile')).toBe('plaintext');
  });

  it('returns javascript for an empty path', () => {
    expect(detectLanguage('')).toBe('javascript');
  });
});

describe('filterChatAttachmentFiles', () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it('keeps supported files within the size limit', () => {
    const ok = upload('a.png', 'image/png', 1000);
    expect(filterChatAttachmentFiles([ok])).toEqual([ok]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('drops unsupported files and toasts', () => {
    const result = filterChatAttachmentFiles([upload('a.txt', 'text/plain', 10)]);
    expect(result).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('not a supported file type'));
  });

  it('drops oversized supported files and toasts the MB limit', () => {
    const big = upload('a.png', 'image/png', 6 * 1024 * 1024);
    expect(filterChatAttachmentFiles([big])).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('5MB limit'));
  });

  it('suppresses toasts when toastOnError is false', () => {
    filterChatAttachmentFiles([upload('a.txt', 'text/plain', 10)], { toastOnError: false });
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('buildFileStructureFromSandboxFiles', () => {
  it('auto-creates parent folders, dedupes, and skips empty paths', () => {
    const meta: FileMetadata[] = [
      { path: 'zeta.md', type: 'file' },
      { path: 'src/b.ts', type: 'file' },
      { path: '/src/a.ts', type: 'file' },
      { path: 'src/a.ts', type: 'file' },
      { path: '', type: 'file' },
      { path: 'alpha.md', type: 'file' },
    ];
    const tree = buildFileStructureFromSandboxFiles(meta);
    expect(tree.map((n) => n.path)).toEqual(['src', 'alpha.md', 'zeta.md']);
    const src = tree.find((n) => n.path === 'src');
    // '/src/a.ts' normalizes to 'src/a.ts', so the later duplicate is ignored.
    expect(src?.children?.map((c) => c.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('carries the binary flag onto file nodes', () => {
    const tree = buildFileStructureFromSandboxFiles([
      { path: 'bin.dat', type: 'file', is_binary: true },
    ]);
    expect(tree[0].is_binary).toBe(true);
  });
});

describe('hasActualFiles', () => {
  it('is true when a file exists anywhere in the tree', () => {
    expect(hasActualFiles([folderNode('src', [fileNode('src/a.ts')])])).toBe(true);
  });

  it('is false for a tree of empty folders', () => {
    expect(hasActualFiles([folderNode('a', [folderNode('a/b', [])])])).toBe(false);
  });
});

describe('traverseFileStructure', () => {
  it('visits every node, dropping ones the processor maps to null', () => {
    const tree = [folderNode('src', [fileNode('src/a.ts')]), fileNode('root.ts')];
    const files = traverseFileStructure(tree, (item) => (item.type === 'file' ? item.path : null));
    expect(files).toEqual(['src/a.ts', 'root.ts']);
  });

  it('passes the parent path to the processor', () => {
    const tree = [folderNode('src', [fileNode('src/a.ts')])];
    const parents = traverseFileStructure(tree, (item, parentPath) => `${parentPath}>${item.path}`);
    expect(parents).toEqual(['>src', 'src>src/a.ts']);
  });
});

describe('fetchAttachmentBlob', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes API attachment URLs through the api client endpoint', async () => {
    const blob = new Blob(['x']);
    const getBlob = vi.fn().mockResolvedValue(blob);
    const result = await fetchAttachmentBlob('/api/v1/attachments/x?t=1', { getBlob });
    expect(getBlob).toHaveBeenCalledWith('/attachments/x?t=1', undefined);
    expect(result).toBe(blob);
  });

  it('fetches non-API URLs directly', async () => {
    const blob = new Blob(['y']);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchAttachmentBlob('https://cdn/x.png', { getBlob: vi.fn() });
    expect(fetchMock).toHaveBeenCalledWith('https://cdn/x.png', { signal: undefined });
    expect(result).toBe(blob);
  });

  it('throws on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchAttachmentBlob('https://cdn/x.png', { getBlob: vi.fn() })).rejects.toThrow(
      'HTTP error! status: 404',
    );
  });
});

describe('downloadAttachmentFile', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:generated'),
        revokeObjectURL: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('downloads a browser object URL via an anchor without hitting the network', async () => {
    const getBlob = vi.fn();
    await downloadAttachmentFile('blob:existing', 'file.png', { getBlob });
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(getBlob).not.toHaveBeenCalled();
  });

  it('rewrites a preview URL to download, fetches via the api client, and revokes the blob', async () => {
    const blob = new Blob(['x']);
    const getBlob = vi.fn().mockResolvedValue(blob);
    await downloadAttachmentFile('/api/v1/attachments/x/preview', 'file.png', { getBlob });
    expect(getBlob).toHaveBeenCalledWith('/attachments/x/download', undefined);
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:generated');
  });
});

describe('convertDataUrlToUploadedFile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the data URL and wraps the blob in a named File', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }));
    const result = await convertDataUrlToUploadedFile('data:image/png;base64,AAAA', 'pic.png');
    expect(result).toBeInstanceOf(File);
    expect(result.name).toBe('pic.png');
    expect(result.type).toBe('image/png');
  });

  it('defaults the filename and type', async () => {
    const blob = new Blob(['x']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }));
    const result = await convertDataUrlToUploadedFile('data:image/png;base64,AAAA');
    expect(result.name).toBe('image.png');
    expect(result.type).toBe('image/png');
  });
});
