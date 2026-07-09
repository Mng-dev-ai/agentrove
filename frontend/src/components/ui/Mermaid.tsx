import { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './primitives/Button/Button';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';

interface MermaidProps {
  content: string;
}

type RenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; svg: string }
  | { status: 'error'; message: string };

const FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const sanitizeSvg = async (svg: string): Promise<string> => {
  const DOMPurify = (await import('dompurify')).default;
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style', 'foreignObject'],
    ADD_ATTR: ['style', 'xmlns', 'class', 'requiredFeatures'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
};

export function Mermaid({ content }: MermaidProps) {
  const theme = useResolvedTheme();
  const [showPreview, setShowPreview] = useState(true);
  const [state, setState] = useState<RenderState>({ status: 'idle' });
  const renderIdRef = useRef(0);

  useEffect(() => {
    if (!showPreview || !content.trim()) {
      setState({ status: 'idle' });
      return;
    }

    const currentRenderId = ++renderIdRef.current;
    setState({ status: 'loading' });

    (async () => {
      const id = `mermaid-${crypto.randomUUID()}`;
      try {
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          theme: theme === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
          startOnLoad: false,
          fontFamily: FONT_FAMILY,
          flowchart: { htmlLabels: true, curve: 'basis' },
        });

        const { svg } = await mermaid.render(id, content);

        const sanitized = await sanitizeSvg(svg);
        if (currentRenderId === renderIdRef.current) {
          setState({ status: 'success', svg: sanitized });
        }
      } catch (err) {
        if (currentRenderId === renderIdRef.current) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to render diagram',
          });
        }
      } finally {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      }
    })();
  }, [showPreview, content, theme]);

  return (
    <div className="my-4 space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => setShowPreview((v) => !v)}
          variant="unstyled"
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface-secondary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover dark:border-border-dark dark:bg-surface-dark-secondary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover"
          disabled={state.status === 'loading'}
        >
          {showPreview ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {showPreview ? 'Show Code' : 'Show Preview'}
        </Button>
      </div>

      {!showPreview && (
        <pre className="overflow-x-auto rounded-xl border border-border bg-surface-secondary p-4 dark:border-border-dark dark:bg-surface-dark-secondary">
          <code className="font-mono text-xs text-text-primary dark:text-text-dark-primary">
            {content}
          </code>
        </pre>
      )}

      {showPreview && state.status === 'loading' && (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-3 text-text-tertiary dark:text-text-dark-tertiary">
            <RefreshCw className="h-5 w-5 motion-safe:animate-spin" />
            <span className="text-sm">Rendering diagram...</span>
          </div>
        </div>
      )}

      {showPreview && state.status === 'error' && (
        <div className="rounded-lg border border-error-200 bg-error-50 p-4 dark:border-error-500/20 dark:bg-error-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-error-500" />
            <div className="flex-1">
              <p className="font-medium text-error-700 dark:text-error-400">
                Failed to render diagram
              </p>
              <p className="mt-1 text-sm text-error-600 dark:text-error-300">{state.message}</p>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-error-600 hover:underline dark:text-error-400">
                  View code
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-error-100 p-3 dark:bg-error-900/20">
                  <code className="text-xs text-error-800 dark:text-error-200">{content}</code>
                </pre>
              </details>
            </div>
          </div>
        </div>
      )}

      {showPreview && state.status === 'success' && (
        <div
          className="mermaid-container overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}
    </div>
  );
}
