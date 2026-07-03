import type * as monacoNs from 'monaco-editor';
import type { EditorNavigationContext } from '@/lib/editorNavigation';
import { useUIStore, type EditorCodeSelection } from '@/store/uiStore';

type Monaco = typeof import('monaco-editor');

const BACKTICK_RUN = /`+/g;

function getSelectionSnippet(ed: monacoNs.editor.ICodeEditor): EditorCodeSelection | null {
  const selection = ed.getSelection();
  const model = ed.getModel();
  if (!selection || selection.isEmpty() || !model) return null;
  let text = model.getValueInRange(selection);
  let endLine = selection.endLineNumber;
  // Full-line drag selections end at column 1 of the line below — don't
  // count that empty line in the range label or the snippet.
  if (endLine > selection.startLineNumber && selection.endColumn === 1) {
    endLine -= 1;
    text = text.slice(0, -1);
  }
  return {
    // Model URIs are `sandbox://{sandboxId}/{workspace path}` (View.tsx).
    path: model.uri.path.slice(1),
    startLine: selection.startLineNumber,
    endLine,
    languageId: model.getLanguageId(),
    text,
  };
}

export function attachAddSelectionToChat(
  m: Monaco,
  editor: monacoNs.editor.IStandaloneCodeEditor,
  context: EditorNavigationContext,
): void {
  // Registered per editor instance (disposed with it) rather than globally —
  // the action reads chatId from the pane's mutable context object, so chat
  // swaps on an already-mounted editor route to the right chat.
  editor.addAction({
    id: 'agentrove.addSelectionToChat',
    label: 'Add Selection to Chat',
    contextMenuGroupId: '0_chat',
    contextMenuOrder: 1,
    keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.KeyL],
    // Without a selection Cmd+L falls through to Monaco's default line-select.
    precondition: 'editorHasSelection',
    run: (ed) => {
      const snippet = getSelectionSnippet(ed);
      const { chatId } = context;
      if (!snippet || !chatId) return;
      useUIStore.getState().addEditorSelection(chatId, snippet);
    },
  });
}

export function attachAskAboutSelection(
  m: Monaco,
  editor: monacoNs.editor.IStandaloneCodeEditor,
  onOpen: (selection: EditorCodeSelection) => void,
): void {
  // Cmd+I mirrors VS Code's inline chat trigger; the pane owning the editor
  // renders the widget, so this action only reports the captured selection.
  editor.addAction({
    id: 'agentrove.askAboutSelection',
    label: 'Ask About Selection',
    contextMenuGroupId: '0_chat',
    contextMenuOrder: 2,
    keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.KeyI],
    precondition: 'editorHasSelection',
    run: (ed) => {
      const snippet = getSelectionSnippet(ed);
      if (!snippet) return;
      onOpen(snippet);
    },
  });
}

export function formatEditorSelections(selections: EditorCodeSelection[], message: string): string {
  // Chips are UI-only; at send time the code rides in the prompt as fenced
  // blocks above the user's text.
  const blocks = selections.map((s) => {
    const lineRef = s.startLine === s.endLine ? `${s.startLine}` : `${s.startLine}-${s.endLine}`;
    // Snippets can contain ``` (Markdown, nested fences) which would close a
    // bare fence early — use one longer than the longest run in the text.
    const longestRun =
      s.text.match(BACKTICK_RUN)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
    const fence = '`'.repeat(Math.max(3, longestRun + 1));
    const block = `${s.path}:${lineRef}\n${fence}${s.languageId}\n${s.text}\n${fence}`;
    return s.comment ? `${block}\n${s.comment}` : block;
  });
  return [...blocks, message].filter(Boolean).join('\n\n');
}
