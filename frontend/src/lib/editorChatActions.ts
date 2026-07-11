import type * as monacoNs from 'monaco-editor';
import type { EditorNavigationContext } from '@/lib/editorNavigation';
import { useUIStore, type EditorCodeSelection } from '@/store/uiStore';

type Monaco = typeof import('monaco-editor');

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
      useUIStore.getState().addComposerSelection(chatId, snippet);
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
