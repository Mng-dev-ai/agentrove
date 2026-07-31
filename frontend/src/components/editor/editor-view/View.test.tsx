// @vitest-environment jsdom
import { render, fireEvent, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileStructure } from '@/types/file-system.types';
import { View, type ViewProps } from './View';

const h = vi.hoisted(() => ({
  fileContent: undefined as { path: string; content: string } | undefined,
  pendingRaf: null as (() => void) | null,
  models: new Map<string, { content: string; reveals: number[] }>(),
  // 0 simulates a jump into a display:none tile (re-centered on first layout).
  layoutHeight: 300,
  layoutChangeCb: null as ((info: { height: number }) => void) | null,
}));

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
}

// The jump effect reveals via requestAnimationFrame; capture the callback so
// tests can fire it deterministically instead of driving real timers.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  h.pendingRaf = null;
  h.models.clear();
  h.layoutHeight = 300;
  h.layoutChangeCb = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    h.pendingRaf = () => cb(performance.now());
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    h.pendingRaf = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Fake @monaco-editor/react: registers a model per path, syncs `value` into it,
// and hands onMount a minimal editor whose reveal calls are recorded per model.
vi.mock('@monaco-editor/react', async () => {
  const { useEffect } = await import('react');
  function makeMonaco() {
    return {
      editor: {
        registerEditorOpener: () => ({ dispose: () => {} }),
        defineTheme: () => {},
        setTheme: () => {},
      },
      languages: {
        registerDefinitionProvider: () => ({ dispose: () => {} }),
        registerReferenceProvider: () => ({ dispose: () => {} }),
        typescript: {
          typescriptDefaults: { setDiagnosticsOptions: () => {}, setCompilerOptions: () => {} },
          javascriptDefaults: { setDiagnosticsOptions: () => {}, setCompilerOptions: () => {} },
          ScriptTarget: {},
          ModuleKind: {},
          JsxEmit: {},
          ModuleResolutionKind: {},
        },
      },
      KeyMod: { CtrlCmd: 0 },
      KeyCode: { KeyL: 0, KeyI: 0 },
    };
  }
  function makeEditor(modelPath: string) {
    return {
      getModel: () => {
        const model = h.models.get(modelPath);
        return {
          getLineCount: () => (model ? model.content.split('\n').length : 0),
        };
      },
      revealLineInCenter: (line: number) => {
        h.models.get(modelPath)?.reveals.push(line);
      },
      setPosition: () => {},
      setSelection: () => {},
      focus: () => {},
      getLayoutInfo: () => ({ height: h.layoutHeight }),
      onDidLayoutChange: (cb: (info: { height: number }) => void) => {
        h.layoutChangeCb = cb;
        return {
          dispose: () => {
            h.layoutChangeCb = null;
          },
        };
      },
      onDidFocusEditorText: () => ({ dispose: () => {} }),
      onMouseMove: () => ({ dispose: () => {} }),
      addAction: () => {},
    };
  }
  function FakeEditor(props: {
    value: string;
    path: string;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) {
    const { value, path, onMount } = props;
    useEffect(() => {
      if (!h.models.has(path)) h.models.set(path, { content: value, reveals: [] });
      onMount?.(makeEditor(path), makeMonaco());
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
      const model = h.models.get(path);
      if (model) model.content = value;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    return null;
  }
  return { default: FakeEditor };
});

vi.mock('@/hooks/queries/useSandboxQueries', () => ({
  useFileContentQuery: () => ({ data: h.fileContent, isLoading: false, error: null }),
  useUpdateFileMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useGitChangedPathsQuery: () => ({ data: { paths: [] } }),
  useGitFileBaselineQuery: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useEditorTheme', () => ({
  useEditorTheme: () => ({ currentTheme: 'custom-light', setupEditorTheme: vi.fn() }),
}));
vi.mock('@/hooks/useResolvedTheme', () => ({ useResolvedTheme: () => 'light' }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/editor/file-preview/FilePreview', () => ({ FilePreview: () => null }));

async function renderView(overrides: Partial<ViewProps> = {}) {
  const props: ViewProps = {
    selectedFile: null,
    fileStructure: [],
    sandboxId: 'sbx',
    chatId: undefined,
    cwd: undefined,
    targetLine: null,
    openFiles: [],
    onFileSelect: vi.fn(),
    onCloseFile: vi.fn(),
    ...overrides,
  };
  // The editor is loaded through React.lazy — await the async act so the
  // Suspense fallback resolves before the jump effect runs.
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<View {...props} />);
  });
  return result;
}

function viewProps(file: FileStructure, targetLine: ViewProps['targetLine']): ViewProps {
  return {
    selectedFile: file,
    fileStructure: [file],
    sandboxId: 'sbx',
    chatId: undefined,
    cwd: undefined,
    targetLine,
    openFiles: [file],
    onFileSelect: vi.fn(),
    onCloseFile: vi.fn(),
  };
}

function modelPath(path: string): string {
  return `sandbox://sbx/${path}`;
}

describe('View jump-to-line reveal', () => {
  it('reveals the requested line when jumping to the open file', async () => {
    const file: FileStructure = { path: 'src/b.ts', type: 'file', content: '' };
    h.fileContent = { path: 'src/b.ts', content: lines(30) };
    await renderView({
      selectedFile: file,
      fileStructure: [file],
      openFiles: [file],
      targetLine: { path: 'src/b.ts', line: 12, nonce: 1 },
    });
    await act(async () => {
      h.pendingRaf?.();
    });
    expect(h.models.get(modelPath('src/b.ts'))?.reveals).toContain(12);
  });

  it('re-reveals the same path/line when the nonce bumps', async () => {
    const file: FileStructure = { path: 'src/b.ts', type: 'file', content: '' };
    h.fileContent = { path: 'src/b.ts', content: lines(30) };
    const { rerender } = await renderView({
      selectedFile: file,
      fileStructure: [file],
      openFiles: [file],
      targetLine: { path: 'src/b.ts', line: 12, nonce: 1 },
    });
    await act(async () => {
      h.pendingRaf?.();
    });
    const model = h.models.get(modelPath('src/b.ts'));
    expect(model?.reveals).toEqual([12]);
    // Re-clicking the same result bumps only the nonce — the reveal must re-fire.
    await act(async () => {
      rerender(<View {...viewProps(file, { path: 'src/b.ts', line: 12, nonce: 2 })} />);
    });
    await act(async () => {
      h.pendingRaf?.();
    });
    expect(model?.reveals).toEqual([12, 12]);
  });

  it('reveals the target after jumping from preview back to code for the same file', async () => {
    const file: FileStructure = { path: 'notes.md', type: 'file', content: '' };
    h.fileContent = { path: 'notes.md', content: lines(10) };
    const { rerender } = await renderView({
      selectedFile: file,
      fileStructure: [file],
      openFiles: [file],
    });
    // notes.md defaults to preview; open in code, return to preview, then jump.
    await act(async () => {
      fireEvent.click(screen.getByText('Raw'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Preview'));
    });
    await act(async () => {
      rerender(<View {...viewProps(file, { path: 'notes.md', line: 4, nonce: 1 })} />);
    });
    await act(async () => {
      h.pendingRaf?.();
    });
    expect(h.models.get(modelPath('notes.md'))?.reveals).toContain(4);
  });

  it('re-reveals the true line after the buffer catches up to a clamped jump', async () => {
    const file: FileStructure = { path: 'src/c.ts', type: 'file', content: '' };
    h.fileContent = { path: 'src/c.ts', content: lines(50) };
    const { rerender } = await renderView({
      selectedFile: file,
      fileStructure: [file],
      openFiles: [file],
      targetLine: { path: 'src/c.ts', line: 90, nonce: 1 },
    });
    await act(async () => {
      h.pendingRaf?.();
    });
    const model = h.models.get(modelPath('src/c.ts'));
    // Buffer (50 lines) is shorter than the requested line — clamped to its end.
    expect(model?.reveals).toEqual([50]);
    // Disk content catches up to the search hit; the jump should land for real.
    h.fileContent = { path: 'src/c.ts', content: lines(100) };
    await act(async () => {
      rerender(<View {...viewProps(file, { path: 'src/c.ts', line: 90, nonce: 1 })} />);
    });
    await act(async () => {
      h.pendingRaf?.();
    });
    expect(model?.reveals).toEqual([50, 90]);
  });

  it('re-centers on the first real layout when revealed at zero height', async () => {
    const file: FileStructure = { path: 'src/d.ts', type: 'file', content: '' };
    h.fileContent = { path: 'src/d.ts', content: lines(30) };
    // Jump fires while the editor tile is still display:none (0-high layout).
    h.layoutHeight = 0;
    await renderView({
      selectedFile: file,
      fileStructure: [file],
      openFiles: [file],
      targetLine: { path: 'src/d.ts', line: 12, nonce: 1 },
    });
    await act(async () => {
      h.pendingRaf?.();
    });
    const model = h.models.get(modelPath('src/d.ts'));
    expect(model?.reveals).toEqual([12]);
    // The tile becomes visible and Monaco lays out — the reveal re-centers once.
    h.layoutHeight = 300;
    await act(async () => {
      h.layoutChangeCb?.({ height: 300 });
    });
    expect(model?.reveals).toEqual([12, 12]);
    // Later layouts (resizes) must not keep yanking the viewport back.
    await act(async () => {
      h.layoutChangeCb?.({ height: 400 });
    });
    expect(model?.reveals).toEqual([12, 12]);
  });
});
