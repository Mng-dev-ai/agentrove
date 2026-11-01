import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchInFiles = vi.fn();
const getFileContent = vi.fn();

vi.mock('@/services/sandboxService', () => ({
  sandboxService: {
    searchInFiles: (...a: unknown[]) => searchInFiles(...a),
    getFileContent: (...a: unknown[]) => getFileContent(...a),
  },
}));
// The app client wires a localStorage persister at import; navigation only needs a cache.
vi.mock('@/lib/queryClient', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});

// Fresh modules per test: navigation keeps module-level activeContext/installed state.
async function load() {
  vi.resetModules();
  const nav = await import('./editorNavigation');
  const { useUIStore } = await import('@/store/uiStore');
  const { queryClient } = await import('@/lib/queryClient');
  queryClient.clear();
  return { ...nav, useUIStore };
}

// Monaco stand-in capturing registered handlers.
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

const context = (over: Partial<{ sandboxId: string; chatId: string }> = {}) => ({
  sandboxId: 'sbx',
  chatId: 'c1',
  cwd: undefined,
  ...over,
});

async function setup() {
  const mod = await load();
  const { m, get } = makeMonaco();
  mod.setupEditorNavigation(m);
  const pendingFileOpen = () => mod.useUIStore.getState().pendingFileOpen;
  return { ...mod, get, pendingFileOpen };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('editor opener context resolution', () => {
  it('rejects a jump when no pane has claimed a context', async () => {
    const { get, pendingFileOpen } = await setup();
    expect(get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/foo.ts'), null)).toBe(false);
    expect(pendingFileOpen()).toBeNull();
  });

  it('rejects a resource whose scheme or authority does not match the claimed sandbox', async () => {
    const { get, attachEditorNavigationContext } = await setup();
    attachEditorNavigationContext(fakeEditor().editor, context());
    expect(get().opener.openCodeEditor({}, uri('sandbox', 'other', '/foo.ts'), null)).toBe(false);
    expect(get().opener.openCodeEditor({}, uri('file', 'sbx', '/foo.ts'), null)).toBe(false);
  });

  it('rejects when the claiming context has no sandbox id', async () => {
    const { get, attachEditorNavigationContext } = await setup();
    attachEditorNavigationContext(fakeEditor().editor, { ...context(), sandboxId: undefined });
    expect(get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/foo.ts'), null)).toBe(false);
  });

  it.each([
    ['a range start line', { startLineNumber: 12 }, 12],
    ['a plain position', { lineNumber: 7 }, 7],
    ['no selection', null, undefined],
  ])('opens the file in the claiming chat at %s', async (_label, selection, line) => {
    const { get, attachEditorNavigationContext, pendingFileOpen } = await setup();
    attachEditorNavigationContext(fakeEditor().editor, context());

    expect(get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/src/foo.ts'), selection)).toBe(
      true,
    );
    expect(pendingFileOpen()).toEqual({ path: 'src/foo.ts', chatId: 'c1', nonce: 1, line });
  });
});

describe('context claim via editor listeners', () => {
  it('re-claims the context when a previously-attached pane fires mouse-move', async () => {
    const { get, attachEditorNavigationContext, pendingFileOpen } = await setup();
    const first = fakeEditor();
    attachEditorNavigationContext(first.editor, context({ chatId: 'c1' }));
    attachEditorNavigationContext(fakeEditor().editor, context({ chatId: 'c2' }));

    first.cbs.move?.();
    get().opener.openCodeEditor({}, uri('sandbox', 'sbx', '/foo.ts'), null);
    expect(pendingFileOpen()?.chatId).toBe('c1');
  });
});

describe('provideDefinition', () => {
  const live = { isCancellationRequested: false };

  function sourceModel(word: string | null) {
    return {
      uri: uri('sandbox', 'sbx', '/src/a.ts'),
      getWordAtPosition: () => (word ? { word } : null),
      getLanguageId: () => 'typescript',
    };
  }

  async function definitionProvider() {
    const { get, attachEditorNavigationContext } = await setup();
    attachEditorNavigationContext(fakeEditor().editor, context());
    return get().defProvider;
  }

  function searchHit(lineNumber: number) {
    searchInFiles.mockResolvedValue({
      results: [{ path: 'a.ts', matches: [{ line_number: lineNumber }] }],
    });
  }

  it('returns null without searching when the cursor is not on a word', async () => {
    const provider = await definitionProvider();
    expect(await provider.provideDefinition(sourceModel(null), {}, live)).toBeNull();
    expect(searchInFiles).not.toHaveBeenCalled();
  });

  it('locates the symbol column in the hydrated file line (1-based)', async () => {
    const provider = await definitionProvider();
    searchHit(2);
    getFileContent.mockResolvedValue({ is_binary: false, content: 'line one\nconst foo = 1\n' });

    const result = (await provider.provideDefinition(sourceModel('foo'), {}, live)) as Array<{
      range: Record<string, number>;
    }>;

    expect(getFileContent).toHaveBeenCalledWith('sbx', 'a.ts');
    expect(result).toHaveLength(1);
    expect(result[0].range).toEqual({
      startLineNumber: 2,
      startColumn: 7,
      endLineNumber: 2,
      endColumn: 10,
    });
  });

  it('skips matches whose line number exceeds the live model length', async () => {
    const provider = await definitionProvider();
    searchHit(9);
    getFileContent.mockResolvedValue({ is_binary: false, content: 'only one line' });
    expect(await provider.provideDefinition(sourceModel('foo'), {}, live)).toEqual([]);
  });

  it('produces no locations for a binary target file', async () => {
    const provider = await definitionProvider();
    searchHit(1);
    getFileContent.mockResolvedValue({ is_binary: true });
    expect(await provider.provideDefinition(sourceModel('foo'), {}, live)).toEqual([]);
  });

  it('returns null on a failed search (errors stay quiet)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = await definitionProvider();
    searchInFiles.mockRejectedValue(new Error('offline'));
    expect(await provider.provideDefinition(sourceModel('foo'), {}, live)).toBeNull();
  });

  it('returns null when cancelled after the search resolves', async () => {
    const provider = await definitionProvider();
    searchHit(1);
    expect(
      await provider.provideDefinition(sourceModel('foo'), {}, { isCancellationRequested: true }),
    ).toBeNull();
  });
});
