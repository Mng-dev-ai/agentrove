import type * as monacoNs from 'monaco-editor';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { sandboxService } from '@/services/sandboxService';
import { useUIStore } from '@/store/uiStore';
import type { SearchFileResult, SearchParams } from '@/types/sandbox.types';
import {
  buildDefinitionSearch,
  escapeSymbolForRegex,
  searchIncludeForLanguage,
} from '@/utils/definitionPatterns';
import { detectLanguage } from '@/utils/file';

type Monaco = typeof import('monaco-editor');

export interface EditorNavigationContext {
  // The owning pane mutates these fields in place on prop changes (chat swap,
  // worktree cwd) — the claim holds the object, not a snapshot, so listeners
  // attached at mount keep routing with current values without remounting.
  sandboxId: string | undefined;
  chatId: string | undefined;
  // Worktree chats operate in a subdirectory; searches must be scoped to it so
  // results don't leak from the base checkout or sibling worktrees.
  cwd: string | undefined;
}

// Peek previews resolve models by URI, so every result file needs a live model;
// cap how many files get hydrated per lookup to bound fetches and memory.
const MAX_RESULT_FILES = 30;

// Chats in one workspace share a sandbox, so sandbox alone can't route a jump —
// the pane the user is interacting with claims the context via editor listeners.
let activeContext: EditorNavigationContext | null = null;

let installed = false;

export function attachEditorNavigationContext(
  editor: monacoNs.editor.IStandaloneCodeEditor,
  context: EditorNavigationContext,
): void {
  // Mouse-move claims cover ctrl+hover in a not-yet-focused split pane; the
  // focus listener covers keyboard-invoked navigation (F12). Listeners are
  // disposed with the editor, and the next interacted pane overwrites the claim.
  activeContext = context;
  editor.onDidFocusEditorText(() => {
    activeContext = context;
  });
  editor.onMouseMove(() => {
    if (activeContext !== context) activeContext = context;
  });
}

function contextForResource(
  uri: monacoNs.Uri,
): { sandboxId: string; chatId: string | undefined; cwd: string | undefined } | null {
  // Editor models are `sandbox://{sandboxId}/{workspace-relative path}` (View.tsx).
  // A mismatch means the model belongs to a pane that never claimed a context
  // (diff views, the chat-less 'workspace' placeholder) — not navigable.
  // Snapshot the fields: the claimed object mutates as pane props change.
  if (!activeContext) return null;
  const { sandboxId, chatId, cwd } = activeContext;
  if (!sandboxId || uri.scheme !== 'sandbox' || uri.authority !== sandboxId) return null;
  return { sandboxId, chatId, cwd };
}

async function searchQuietly(
  sandboxId: string,
  params: SearchParams,
): Promise<SearchFileResult[] | null> {
  // A toast per failed hover/jump would be noisy; on error Monaco just shows
  // its own "no definition found" affordance.
  try {
    const response = await sandboxService.searchInFiles(sandboxId, params);
    return response.results;
  } catch (err) {
    console.error('Symbol search failed', err);
    return null;
  }
}

async function ensureModel(
  m: Monaco,
  sandboxId: string,
  filePath: string,
): Promise<monacoNs.editor.ITextModel | null> {
  // Hydrate missing models through the file-content query so the cache is
  // already warm when the user actually opens the target file.
  const uri = m.Uri.parse(`sandbox://${sandboxId}/${filePath}`);
  const existing = m.editor.getModel(uri);
  if (existing) return existing;
  try {
    const data = await queryClient.fetchQuery({
      queryKey: queryKeys.sandbox.fileContent(sandboxId, filePath),
      queryFn: () => sandboxService.getFileContent(sandboxId, filePath),
    });
    if (data.is_binary) return null;
    // Re-check after the await: a concurrent lookup may have created it first.
    return (
      m.editor.getModel(uri) ?? m.editor.createModel(data.content, detectLanguage(filePath), uri)
    );
  } catch (err) {
    console.error('Failed to load file for navigation', err);
    return null;
  }
}

async function resolveLocations(
  m: Monaco,
  sandboxId: string,
  symbol: string,
  files: SearchFileResult[],
  token: monacoNs.CancellationToken,
): Promise<monacoNs.languages.Location[]> {
  const capped = files.slice(0, MAX_RESULT_FILES);
  const models = await Promise.all(capped.map((f) => ensureModel(m, sandboxId, f.path)));
  if (token.isCancellationRequested) return [];
  const wordPattern = new RegExp(`\\b${escapeSymbolForRegex(symbol)}\\b`);
  const locations: monacoNs.languages.Location[] = [];
  capped.forEach((file, i) => {
    const model = models[i];
    if (!model) return;
    for (const match of file.matches) {
      // The model can be shorter than the on-disk hit (stale hydration, drafts).
      if (match.line_number > model.getLineCount()) continue;
      // Backend line_text is lstripped/windowed for the search sidebar, so its
      // offsets aren't real columns — locate the symbol in the live model line.
      const column = model.getLineContent(match.line_number).search(wordPattern);
      locations.push({
        uri: model.uri,
        range: {
          startLineNumber: match.line_number,
          startColumn: column >= 0 ? column + 1 : 1,
          endLineNumber: match.line_number,
          endColumn: column >= 0 ? column + 1 + symbol.length : 1,
        },
      });
    }
  });
  return locations;
}

export function setupEditorNavigation(m: Monaco): void {
  // Providers are Monaco-global while the editor remounts per file, so install
  // once and resolve per-call context from the claiming pane + model URI.
  if (installed) return;
  installed = true;

  // Monaco calls this when a jump targets a resource the current editor isn't
  // showing (single cross-file definition, or picking an entry in a peek).
  m.editor.registerEditorOpener({
    openCodeEditor: (_source, resource, selectionOrPosition) => {
      const context = contextForResource(resource);
      if (!context) return false;
      let line: number | undefined;
      if (selectionOrPosition) {
        line =
          'startLineNumber' in selectionOrPosition
            ? selectionOrPosition.startLineNumber
            : selectionOrPosition.lineNumber;
      }
      useUIStore.getState().openFileInEditor(resource.path.slice(1), context.chatId, line);
      return true;
    },
  });

  m.languages.registerDefinitionProvider('*', {
    provideDefinition: async (model, position, token) => {
      const context = contextForResource(model.uri);
      const word = model.getWordAtPosition(position);
      if (!context || !word) return null;
      const search = buildDefinitionSearch(model.getLanguageId(), word.word);
      const files = await searchQuietly(context.sandboxId, {
        query: search.pattern,
        cwd: context.cwd,
        regex: true,
        caseSensitive: true,
        include: search.include,
      });
      if (!files || token.isCancellationRequested) return null;
      return resolveLocations(m, context.sandboxId, word.word, files, token);
    },
  });

  m.languages.registerReferenceProvider('*', {
    provideReferences: async (model, position, _context, token) => {
      const context = contextForResource(model.uri);
      const word = model.getWordAtPosition(position);
      if (!context || !word) return null;
      const files = await searchQuietly(context.sandboxId, {
        query: word.word,
        cwd: context.cwd,
        wholeWord: true,
        caseSensitive: true,
        include: searchIncludeForLanguage(model.getLanguageId()),
      });
      if (!files || token.isCancellationRequested) return null;
      return resolveLocations(m, context.sandboxId, word.word, files, token);
    },
  });
}
