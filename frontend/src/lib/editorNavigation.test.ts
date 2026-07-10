import { describe, it, expect, vi, beforeEach } from 'vitest';

const openFileInEditor = vi.fn();
const searchInFiles = vi.fn();
const fetchQuery = vi.fn();

vi.mock('@/store/uiStore', () => ({
  useUIStore: { getState: () => ({ openFileInEditor }) },
}));
vi.mock('@/services/sandboxService', () => ({
  sandboxService: {
    searchInFiles: (...a: unknown[]) => searchInFiles(...a),
    getFileContent: vi.fn(),
  },
}));
vi.mock('@/lib/queryClient', () => ({
  queryClient: { fetchQuery: (...a: unknown[]) => fetchQuery(...a) },
}));
// Avoid pulling the file util's react-hot-toast import chain into the node run.
vi.mock('@/utils/file', () => ({ detectLanguage: () => 'plaintext' }));

// Fresh module per test so the module-level activeContext/installed reset.
async function load() {
  vi.resetModules();
  return import('./editorNavigation');
}

// Minimal Monaco stand-in capturing the handlers the module registers.
function makeMonaco() {
  const models = new Map<string, FakeModel>();
  let opener: OpenerHandler;
  let defProvider: DefProvider;
  const Uri = {
    parse: (s: string) => {
      const match = /^(\w+):\/\/([^/]*)(\/.*)$/.exec(s)!;
      return uri(match[1], match[2], match[3]);
    },
  };
  const editor = {
    registerEditorOpener: (o: OpenerHandler) => {
      opener = o;
      return { dispose() {} };
    },
    getModel: (u: FakeUri) => models.get(u.toString()),
    createModel: (content: string, _lang: string, u: FakeUri) => {
      const lines = content.split('\n');
      const model: FakeModel = {
        uri: u,
        getLineCount: () => lines.length,
        getLineContent: (n: number) => lines[n - 1] ?? '',
      };
      models.set(u.toString(), model);
      return model;
    },
  };
  const languages = {
    registerDefinitionProvider: (_s: string, p: DefProvider) => {
      defProvider = p;
      return { dispose() {} };
    },
    registerReferenceProvider: () => ({ dispose() {} }),
  };
  const m = { editor, languages, Uri } as unknown as MonacoLike;
  return { m, get: () => ({ opener: opener!, defProvider: defProvider! }) };
}

function uri(scheme: string, authority: string, path: string): FakeUri {
  return { scheme, authority, path, toString: () => `${scheme}://${authority}${path}` };
}

function fakeEditor() {
  const cbs: { focus?: () => void; move?: () => void } = {};
  return {
    editor: {
      onDidFocusEditorText: (cb: () => void) => {
        cbs.focus = cb;
        return { dispose() {} };
      },
      onMouseMove: (cb: () => void) => {
        cbs.move = cb;
        return { dispose() {} };
      },
    } as unknown as Parameters<
      (typeof import('./editorNavigation'))['attachEditorNavigationContext']
    >[0],
    cbs,
  };
}

interface FakeUri {
  scheme: string;
  authority: string;
  path: string;
  toString(): string;
}
interface FakeModel {
  uri: FakeUri;
  getLineCount(): number;
  getLineContent(n: number): string;
}
type OpenerHandler = {
  openCodeEditor: (source: unknown, resource: FakeUri, sel: unknown) => boolean;
};
type DefProvider = {
  provideDefinition: (model: unknown, position: unknown, token: unknown) => Promise<unknown>;
};
type MonacoLike = Parameters<(typeof import('./editorNavigation'))['setupEditorNavigation']>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('editor opener context resolution', () => {
  it('rejects a jump when no pane has claimed a context', async () => {
    const { setupEditorNavigation } = await load();
    const { m, get } = makeMonaco();
    setupEditorNavigation(m);
    const ok = get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/foo.ts'), null);
    expect(ok).toBe(false);
    expect(openFileInEditor).not.toHaveBeenCalled();
  });

  it('rejects a resource whose authority is not the claimed sandbox', async () => {
    const { setupEditorNavigation, attachEditorNavigationContext } = await load();
    const { m, get } = makeMonaco();
    setupEditorNavigation(m);
    attachEditorNavigationContext(fakeEditor().editor, {
      sandboxId: 'sbx',
      chatId: 'c1',
      cwd: undefined,
    });
    expect(get().opener.openCodeEditor({}, uri('sandbox', 'other', '/foo.ts'), null)).toBe(false);
    expect(get().opener.openCodeEditor({}, uri('file', 'sbx', '/foo.ts'), null)).toBe(false);
  });

  it('opens the file (path without leading slash) using a range start line', async () => {
    const { setupEditorNavigation, attachEditorNavigationContext } = await load();
    const { m, get } = makeMonaco();
    setupEditorNavigation(m);
    attachEditorNavigationContext(fakeEditor().editor, {
      sandboxId: 'sbx',
      chatId: 'c1',
      cwd: undefined,
    });
    const ok = get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/src/foo.ts'), {
      startLineNumber: 12,
    });
    expect(ok).toBe(true);
    expect(openFileInEditor).toHaveBeenCalledWith('src/foo.ts', 'c1', 12);
  });

  it('uses a plain position line number when no range is present', async () => {
    const { setupEditorNavigation, attachEditorNavigationContext } = await load();
    const { m, get } = makeMonaco();
    setupEditorNavigation(m);
    attachEditorNavigationContext(fakeEditor().editor, {
      sandboxId: 'sbx',
      chatId: 'c1',
      cwd: undefined,
    });
    get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/foo.ts'), { lineNumber: 7 });
    expect(openFileInEditor).toHaveBeenCalledWith('foo.ts', 'c1', 7);
  });

  it('passes an undefined line when no selection is given', async () => {
    const { setupEditorNavigation, attachEditorNavigationContext } = await load();
    const { m, get } = makeMonaco();
    setupEditorNavigation(m);
    attachEditorNavigationContext(fakeEditor().editor, {
      sandboxId: 'sbx',
      chatId: 'c1',
      cwd: undefined,
    });
    get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/foo.ts'), null);
    expect(openFileInEditor).toHaveBeenCalledWith('foo.ts', 'c1', undefined);
  });

  it('rejects when the claiming context has no sandbox id', async () => {
    const { setupEditorNavigation, attachEditorNavigationContext } = await load();
    const { m, get } = makeMonaco();
    setupEditorNavigation(m);
    attachEditorNavigationContext(fakeEditor().editor, {
      sandboxId: undefined,
      chatId: 'c1',
      cwd: undefined,
    });
    expect(get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/foo.ts'), null)).toBe(false);
  });
});

describe('context claim via editor listeners', () => {
  it('re-claims the context when a previously-attached pane fires mouse-move', async () => {
    const { setupEditorNavigation, attachEditorNavigationContext } = await load();
    const { m, get } = makeMonaco();
    setupEditorNavigation(m);

    const first = fakeEditor();
    attachEditorNavigationContext(first.editor, { sandboxId: 'sbx', chatId: 'c1', cwd: undefined });
    // A second pane becomes the active claim.
    attachEditorNavigationContext(fakeEditor().editor, {
      sandboxId: 'sbx',
      chatId: 'c2',
      cwd: undefined,
    });
    // Interacting with the first pane reclaims it, so jumps route to c1 again.
    first.cbs.move?.();
    get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/foo.ts'), null);
    expect(openFileInEditor).toHaveBeenLastCalledWith('foo.ts', 'c1', undefined);
  });
});

describe('provideDefinition', () => {
  function sourceModel(word: string | null) {
    return {
      uri: uri('sandbox', 'sbx', '/src/a.ts'),
      getWordAtPosition: () => (word ? { word } : null),
      getLanguageId: () => 'typescript',
    };
  }

  async function setup() {
    const mod = await load();
    const { m, get } = makeMonaco();
    mod.setupEditorNavigation(m);
    mod.attachEditorNavigationContext(fakeEditor().editor, {
      sandboxId: 'sbx',
      chatId: 'c1',
      cwd: undefined,
    });
    return get().defProvider;
  }

  it('returns null when the cursor is not on a word', async () => {
    const provider = await setup();
    const result = await provider.provideDefinition(
      sourceModel(null),
      {},
      {
        isCancellationRequested: false,
      },
    );
    expect(result).toBeNull();
    expect(searchInFiles).not.toHaveBeenCalled();
  });

  it('locates the symbol column in the live model line (1-based)', async () => {
    const provider = await setup();
    searchInFiles.mockResolvedValue({ results: [{ path: 'a.ts', matches: [{ line_number: 2 }] }] });
    fetchQuery.mockResolvedValue({ is_binary: false, content: 'line one\nconst foo = 1\n' });

    const result = (await provider.provideDefinition(
      sourceModel('foo'),
      {},
      {
        isCancellationRequested: false,
      },
    )) as Array<{ range: Record<string, number> }>;

    // 'const foo = 1' -> 'foo' starts at index 6, so column 7 (1-based).
    expect(result).toHaveLength(1);
    expect(result[0].range).toMatchObject({
      startLineNumber: 2,
      startColumn: 7,
      endLineNumber: 2,
      endColumn: 10,
    });
  });

  it('skips matches whose line number exceeds the live model length', async () => {
    const provider = await setup();
    searchInFiles.mockResolvedValue({ results: [{ path: 'a.ts', matches: [{ line_number: 9 }] }] });
    fetchQuery.mockResolvedValue({ is_binary: false, content: 'only one line' });
    const result = (await provider.provideDefinition(
      sourceModel('foo'),
      {},
      {
        isCancellationRequested: false,
      },
    )) as unknown[];
    expect(result).toEqual([]);
  });

  it('produces no locations for a binary target file', async () => {
    const provider = await setup();
    searchInFiles.mockResolvedValue({ results: [{ path: 'a.ts', matches: [{ line_number: 1 }] }] });
    fetchQuery.mockResolvedValue({ is_binary: true });
    const result = (await provider.provideDefinition(
      sourceModel('foo'),
      {},
      {
        isCancellationRequested: false,
      },
    )) as unknown[];
    expect(result).toEqual([]);
  });

  it('returns null on a failed search (errors stay quiet)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = await setup();
    searchInFiles.mockRejectedValue(new Error('offline'));
    const result = await provider.provideDefinition(
      sourceModel('foo'),
      {},
      {
        isCancellationRequested: false,
      },
    );
    expect(result).toBeNull();
    errSpy.mockRestore();
  });

  it('returns null when cancelled after the search resolves', async () => {
    const provider = await setup();
    searchInFiles.mockResolvedValue({ results: [{ path: 'a.ts', matches: [{ line_number: 1 }] }] });
    const result = await provider.provideDefinition(
      sourceModel('foo'),
      {},
      {
        isCancellationRequested: true,
      },
    );
    expect(result).toBeNull();
  });
});
