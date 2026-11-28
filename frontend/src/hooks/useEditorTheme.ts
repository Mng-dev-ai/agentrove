import { useCallback } from 'react';
import { useAppliedPalette } from '@/hooks/useResolvedTheme';
import { THEME_DATA } from '@/styles/editorThemes';

export function useEditorTheme() {
  const themeName = `custom-${useAppliedPalette()}`;

  const setupEditorTheme = useCallback(
    (monaco: typeof import('monaco-editor')) => {
      if (!monaco || !monaco.editor) return;

      for (const [name, { data }] of Object.entries(THEME_DATA)) {
        monaco.editor.defineTheme(`custom-${name}`, data);
      }

      // Browser Monaco has no repo tsconfig — semantic diagnostics false-flag imports/React types.
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSuggestionDiagnostics: true,
      });

      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSuggestionDiagnostics: true,
      });

      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        jsx: monaco.languages.typescript.JsxEmit.React,
        lib: ['es2020', 'dom'],
        strict: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      });

      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        jsx: monaco.languages.typescript.JsxEmit.React,
        lib: ['es2020', 'dom'],
        allowJs: true,
        checkJs: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      });

      monaco.editor.setTheme(themeName);
    },
    [themeName],
  );

  return {
    currentTheme: themeName,
    setupEditorTheme,
  };
}
