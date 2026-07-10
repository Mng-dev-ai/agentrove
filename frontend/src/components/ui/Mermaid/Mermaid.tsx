import { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import styles from './Mermaid.module.scss';

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
    <div className={styles.mermaid}>
      <div className={styles.toolbar}>
        <Button
          onClick={() => setShowPreview((v) => !v)}
          variant="unstyled"
          className={styles['toggle-btn']}
          disabled={state.status === 'loading'}
        >
          {showPreview ? (
            <Eye className={styles['toggle-icon']} />
          ) : (
            <EyeOff className={styles['toggle-icon']} />
          )}
          {showPreview ? 'Show Code' : 'Show Preview'}
        </Button>
      </div>

      {!showPreview && (
        <pre className={styles['code-block']}>
          <code className={styles.code}>{content}</code>
        </pre>
      )}

      {showPreview && state.status === 'loading' && (
        <div className={styles.loading}>
          <div className={styles['loading-inner']}>
            <RefreshCw className={styles['loading-icon']} />
            <span className={styles['loading-text']}>Rendering diagram...</span>
          </div>
        </div>
      )}

      {showPreview && state.status === 'error' && (
        <div className={styles['error-block']}>
          <div className={styles['error-inner']}>
            <AlertCircle className={styles['error-icon']} />
            <div className={styles['error-content']}>
              <p className={styles['error-title']}>Failed to render diagram</p>
              <p className={styles['error-message']}>{state.message}</p>
              <details className={styles['error-details']}>
                <summary className={styles['error-summary']}>View code</summary>
                <pre className={styles['error-code']}>
                  <code className={styles['error-code-text']}>{content}</code>
                </pre>
              </details>
            </div>
          </div>
        </div>
      )}

      {showPreview && state.status === 'success' && (
        // 'mermaid-container' is a global hook targeted by rehype/mermaid post-processing.
        <div
          className={`mermaid-container ${styles.diagram}`}
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}
    </div>
  );
}
