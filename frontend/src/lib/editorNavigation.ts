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
  // Pane mutates in place (chat/cwd); claim holds the object so mount-time listeners stay current.
  sandboxId: string | undefined;
  chatId: string | undefined;
  // Scope searches to worktree cwd so results don't leak from the base checkout.
  cwd: string | undefined;
}

// Cap hydrations per lookup — peek needs a live model per hit.
const MAX_RESULT_FILES = 30;

// Shared sandbox across chats: the interacting pane claims context via listeners.
let activeContext: EditorNavigationContext | null = null;

let installed = false;

export function attachEditorNavigationContext(
  editor: monacoNs.editor.IStandaloneCodeEditor,
  context: EditorNavigationContext,
): void {
  // Mouse-move: ctrl+hover in unfocused split; focus: F12. Next pane overwrites claim.
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
  // Models are sandbox://{sandboxId}/path (View.tsx). Mismatch / no claim → not navigable.
  // Snapshot fields: the claimed object mutates with pane props.
  if (!activeContext) return null;
  const { sandboxId, chatId, cwd } = activeContext;
  if (!sandboxId || uri.scheme !== 'sandbox' || uri.authority !== sandboxId) return null;
  return { sandboxId, chatId, cwd };
}

async function searchQuietly(
  sandboxId: string,
  params: SearchParams,
): Promise<SearchFileResult[] | null> {
  // Fail quietly — Monaco already shows "no definition found".
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
  // Hydrate via file-content query so cache is warm if the user opens the file.
  const uri = m.Uri.parse(`sandbox://${sandboxId}/${filePath}`);
  const existing = m.editor.getModel(uri);
  if (existing) return existing;
  try {
    const data = await queryClient.fetchQuery({
      queryKey: queryKeys.sandbox.fileContent(sandboxId, filePath),
      queryFn: () => sandboxService.getFileContent(sandboxId, filePath),
    });
    if (data.is_binary) return null;
    // Concurrent lookup may have created the model while we awaited.
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
      // Model can be shorter than on-disk hit (stale hydration, drafts).
      if (match.line_number > model.getLineCount()) continue;
      // Backend line_text is lstripped/windowed — locate symbol in the live line.
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
  // Providers are global; editor remounts per file — install once, resolve context per call.
  if (installed) return;
  installed = true;

  // Cross-file jump / peek pick when the target isn't the current editor resource.
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
