import { describe, it, expect, vi, beforeEach } from 'vitest';

const { addComposerSelection } = vi.hoisted(() => ({ addComposerSelection: vi.fn() }));

vi.mock('@/store/uiStore', () => ({
  useUIStore: { getState: () => ({ addComposerSelection }) },
}));

import { attachAddSelectionToChat, attachAskAboutSelection } from './editorChatActions';

// Keybinding constants the action factory reads.
const monaco = { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyL: 2, KeyI: 3 } };

interface FakeSelection {
  isEmpty: () => boolean;
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
}

// Fake editor + handle to invoke the registered action.
function makeEditor(opts: {
  selection: FakeSelection | null;
  value?: string;
  path?: string;
  languageId?: string;
}) {
  const model =
    opts.selection == null && opts.value === undefined
      ? null
      : {
          getValueInRange: () => opts.value ?? '',
          uri: { path: opts.path ?? '/src/index.ts' },
          getLanguageId: () => opts.languageId ?? 'typescript',
        };

  const registered: { run: (ed: unknown) => void }[] = [];
  const editor = {
    addAction: (descriptor: { run: (ed: unknown) => void }) => {
      registered.push(descriptor);
    },
    getSelection: () => opts.selection,
    getModel: () => model,
  };
  return {
    editor,
    fire: () => registered[0].run(editor),
  };
}

const selection = (over: Partial<FakeSelection> = {}): FakeSelection => ({
  isEmpty: () => false,
  startLineNumber: 3,
  endLineNumber: 5,
  startColumn: 1,
  endColumn: 10,
  ...over,
});

beforeEach(() => {
  addComposerSelection.mockClear();
});

describe('attachAddSelectionToChat', () => {
  it('adds the captured snippet to the target chat', () => {
    const { editor, fire } = makeEditor({
      selection: selection(),
      value: 'const x = 1;',
      path: '/src/foo.ts',
      languageId: 'typescript',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachAddSelectionToChat(monaco as any, editor as any, { chatId: 'chat-1' } as any);

    fire();

    expect(addComposerSelection).toHaveBeenCalledWith('chat-1', {
      // Leading slash is stripped from the model URI path.
      path: 'src/foo.ts',
      startLine: 3,
      endLine: 5,
      languageId: 'typescript',
      text: 'const x = 1;',
    });
  });

  it('trims the trailing empty line for a full-line drag selection', () => {
    const { editor, fire } = makeEditor({
      // Full-line drag ends at column 1 of the line below.
      selection: selection({ startLineNumber: 3, endLineNumber: 6, endColumn: 1 }),
      value: 'line3\nline4\nline5\n',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachAddSelectionToChat(monaco as any, editor as any, { chatId: 'c' } as any);

    fire();

    const snippet = addComposerSelection.mock.calls[0][1];
    expect(snippet.endLine).toBe(5);
    expect(snippet.text).toBe('line3\nline4\nline5');
  });

  it('does nothing when there is no selection', () => {
    const { editor, fire } = makeEditor({ selection: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachAddSelectionToChat(monaco as any, editor as any, { chatId: 'c' } as any);

    fire();

    expect(addComposerSelection).not.toHaveBeenCalled();
  });

  it('does nothing when the context has no chatId', () => {
    const { editor, fire } = makeEditor({ selection: selection(), value: 'x' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachAddSelectionToChat(monaco as any, editor as any, { chatId: undefined } as any);

    fire();

    expect(addComposerSelection).not.toHaveBeenCalled();
  });
});

describe('attachAskAboutSelection', () => {
  it('reports the captured selection to the onOpen callback', () => {
    const onOpen = vi.fn();
    const { editor, fire } = makeEditor({ selection: selection(), value: 'y', path: '/a/b.ts' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachAskAboutSelection(monaco as any, editor as any, onOpen);

    fire();

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: 'a/b.ts', text: 'y' }));
  });

  it('does not fire onOpen without a selection', () => {
    const onOpen = vi.fn();
    const { editor, fire } = makeEditor({ selection: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachAskAboutSelection(monaco as any, editor as any, onOpen);

    fire();

    expect(onOpen).not.toHaveBeenCalled();
  });
});
