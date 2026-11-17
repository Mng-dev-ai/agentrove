import { useState, useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { useUIStore } from '@/store/uiStore';
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

const RENDER_DEBOUNCE_MS = 250;

const DIAGRAM_TYPES = [
  'class',
  'state',
  'er',
  'gantt',
  'journey',
  'pie',
  'gitGraph',
  'mindmap',
  'timeline',
  'requirement',
  'quadrantChart',
  'xyChart',
  'sankey',
  'block',
];

const NATURAL_SIZE = Object.fromEntries(
  DIAGRAM_TYPES.map((type) => [type, { useMaxWidth: false }]),
);

const toRgb = (channels: string) => `rgb(${channels.trim().split(/\s+/).join(', ')})`;

function buildThemeVariables(shell: HTMLElement, darkMode: boolean) {
  const root = getComputedStyle(document.documentElement);
  const color = (token: string) => toRgb(root.getPropertyValue(`--theme-${token}-rgb`));
  const { fontFamily, fontSize } = getComputedStyle(shell);
  return {
    darkMode,
    fontFamily,
    fontSize,
    background: color('surface-secondary'),
    mainBkg: color('surface-tertiary'),
    primaryColor: color('surface-tertiary'),
    primaryTextColor: color('text-primary'),
    primaryBorderColor: color('text-tertiary'),
    secondaryColor: color('surface-hover'),
    secondaryTextColor: color('text-primary'),
    secondaryBorderColor: color('text-tertiary'),
    tertiaryColor: color('surface'),
    tertiaryTextColor: color('text-primary'),
    tertiaryBorderColor: color('text-tertiary'),
    textColor: color('text-secondary'),
    lineColor: color('text-tertiary'),
    nodeBorder: color('text-tertiary'),
    clusterBkg: color('surface'),
    clusterBorder: color('border'),
    edgeLabelBackground: color('surface-secondary'),
    titleColor: color('text-primary'),
    actorBkg: color('surface-tertiary'),
    actorBorder: color('text-tertiary'),
    actorTextColor: color('text-primary'),
    actorLineColor: color('text-tertiary'),
    signalColor: color('text-tertiary'),
    signalTextColor: color('text-secondary'),
    labelBoxBkgColor: color('surface-tertiary'),
    labelBoxBorderColor: color('text-tertiary'),
    labelTextColor: color('text-primary'),
    loopTextColor: color('text-secondary'),
    noteBkgColor: color('surface-hover'),
    noteBorderColor: color('text-tertiary'),
    noteTextColor: color('text-primary'),
  };
}

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
  const palette = useUIStore((state) => state.theme);
  const resolvedTheme = useResolvedTheme();
  const [showPreview, setShowPreview] = useState(true);
  const [state, setState] = useState<RenderState>({ status: 'idle' });
  const shellRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);

  useEffect(() => {
    if (!showPreview || !content.trim()) {
      setState({ status: 'idle' });
      return;
    }

    const currentRenderId = ++renderIdRef.current;
    setState((prev) => (prev.status === 'success' ? prev : { status: 'loading' }));

    const timer = setTimeout(async () => {
      const id = `mermaid-${crypto.randomUUID()}`;
      try {
        const mermaid = (await import('mermaid')).default;

        const themeVariables = buildThemeVariables(shellRef.current!, resolvedTheme === 'dark');
        const fontSize = parseFloat(themeVariables.fontSize);

        mermaid.initialize({
          theme: 'base',
          themeVariables,
          securityLevel: 'strict',
          startOnLoad: false,
          ...NATURAL_SIZE,
          htmlLabels: false,
          flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'basis' },
          sequence: { useMaxWidth: false },
          fontSize,
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
    }, RENDER_DEBOUNCE_MS);

    // Invalidate the in-flight render on cleanup so it can't set state after
    // unmount (or after showPreview flipped the effect onto its early-return path).
    return () => {
      clearTimeout(timer);
      renderIdRef.current += 1;
    };
  }, [showPreview, content, palette, resolvedTheme]);

  return (
    <div ref={shellRef} className={styles.mermaid}>
      <div className={styles.header}>
        <span className={styles.label}>Mermaid</span>
        <Button
          onClick={() => setShowPreview((v) => !v)}
          variant="ghost"
          size="sm"
          disabled={state.status === 'loading'}
        >
          {showPreview ? 'Show code' : 'Show diagram'}
        </Button>
      </div>

      {showPreview && state.status === 'loading' && (
        <div className={styles.loading}>
          <RefreshCw className={styles['loading-icon']} />
          <span>Rendering diagram...</span>
        </div>
      )}

      {showPreview && state.status === 'success' && (
        <div className={styles.diagram} dangerouslySetInnerHTML={{ __html: state.svg }} />
      )}

      {showPreview && state.status === 'error' && (
        <FieldMessage className={styles.note}>
          Couldn&apos;t render this diagram. {state.message.split('\n')[0]}
        </FieldMessage>
      )}

      {(!showPreview || state.status === 'error') && (
        <pre className={styles.source}>
          <code className={styles.code}>{content}</code>
        </pre>
      )}
    </div>
  );
}
