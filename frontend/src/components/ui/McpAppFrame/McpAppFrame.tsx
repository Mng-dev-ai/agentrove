import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppliedPalette, useResolvedTheme } from '@/hooks/useResolvedTheme';
import { getFrameThemeVariables } from '@/utils/frameTheme';
import styles from './McpAppFrame.module.scss';

interface McpAppFrameProps {
  html: string;
  title: string;
  onMessage: (text: string) => void;
}

const PROTOCOL_VERSION = '2026-01-26';
const INITIAL_HEIGHT = 200;
// Inherited CSPs only add restrictions, so this applies on top of the app's own policy.
const APP_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const extractMessageText = (params: unknown): string | null => {
  if (!isRecord(params) || !Array.isArray(params.content)) return null;
  const text = params.content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        isRecord(block) && block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('\n')
    .trim();
  return text || null;
};

// Host side of the MCP Apps (ext-apps) postMessage protocol. The frame runs with an
// opaque origin, so every message to it targets '*' and inbound messages are
// authenticated by event.source alone. Tool calls from the app are not supported.
export const McpAppFrame = memo(function McpAppFrame({ html, title, onMessage }: McpAppFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [isInitialized, setIsInitialized] = useState(false);
  const resolvedTheme = useResolvedTheme();
  const palette = useAppliedPalette();
  const isDark = resolvedTheme === 'dark';
  const hostContext = useMemo(
    () => ({
      theme: isDark ? 'dark' : 'light',
      styles: { variables: getFrameThemeVariables(isDark, palette) },
    }),
    [isDark, palette],
  );
  const srcDoc = useMemo(
    () => `<meta http-equiv="Content-Security-Policy" content="${APP_CSP}">${html}`,
    [html],
  );

  useLayoutEffect(() => {
    const post = (message: Record<string, unknown>) =>
      iframeRef.current?.contentWindow?.postMessage({ jsonrpc: '2.0', ...message }, '*');

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message: unknown = event.data;
      if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return;
      }
      const id =
        typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;

      switch (message.method) {
        case 'ui/initialize':
          post({
            id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              hostInfo: { name: 'agentrove', version: '1.0.0' },
              hostCapabilities: {},
              hostContext,
            },
          });
          return;
        case 'ui/notifications/initialized':
          setIsInitialized(true);
          return;
        case 'ui/notifications/size-changed':
          if (isRecord(message.params) && typeof message.params.height === 'number') {
            setHeight(Math.ceil(message.params.height));
          }
          return;
        case 'ui/message': {
          const text = extractMessageText(message.params);
          if (text) onMessage(text);
          post({ id, result: {} });
          return;
        }
        default:
          if (id !== null) post({ id, error: { code: -32601, message: 'Method not found' } });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [hostContext, onMessage]);

  useEffect(() => {
    if (!isInitialized) return;
    iframeRef.current?.contentWindow?.postMessage(
      { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: hostContext },
      '*',
    );
  }, [hostContext, isInitialized]);

  return (
    <div className={styles.frame}>
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-forms"
        className={styles.iframe}
        style={{ height: `${height}px` }}
      />
    </div>
  );
});
