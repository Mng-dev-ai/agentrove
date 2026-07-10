import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useUIStore } from '@/store/uiStore';
import type { CustomPalette, PaletteTokens } from '@/utils/theme';
import { CUSTOM_PALETTE_TOKENS } from '@/utils/theme';
import type { Theme } from '@/types/ui.types';
import styles from './VisualWidget.module.scss';

interface VisualWidgetProps {
  code: string;
}

// Hex values mirror tailwind.config.js design tokens — kept in sync manually
// because the iframe is a separate document with no Tailwind context.
const SHARED_VARS = `
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-serif: Georgia, 'Times New Roman', serif;
  --font-mono: 'SF Mono', Menlo, Consolas, monospace;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;`;

const THEME_CSS_DARK = `:root {
  --color-text-primary: #ffffff;
  --color-text-secondary: #e0e0e0;
  --color-text-tertiary: #c0c0c0;
  --color-text-info: #60a5fa;
  --color-text-success: #4ade80;
  --color-text-warning: #fbbf24;
  --color-text-danger: #f87171;
  --color-background-primary: #0a0a0a;
  --color-background-secondary: #141414;
  --color-background-tertiary: #1e1e1e;
  --color-background-info: #1e3a8a;
  --color-background-success: #14532d;
  --color-background-warning: #78350f;
  --color-background-danger: #7f1d1d;
  --color-border-primary: rgba(255,255,255,0.4);
  --color-border-secondary: rgba(255,255,255,0.3);
  --color-border-tertiary: rgba(255,255,255,0.15);
  --color-border-info: #3b82f6;${SHARED_VARS}
}`;

const THEME_CSS_LIGHT = `:root {
  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-tertiary: #64748b;
  --color-text-info: #2563eb;
  --color-text-success: #16a34a;
  --color-text-warning: #d97706;
  --color-text-danger: #dc2626;
  --color-background-primary: #f5f5f5;
  --color-background-secondary: #f9f9f9;
  --color-background-tertiary: #f3f3f3;
  --color-background-info: #eff6ff;
  --color-background-success: #f0fdf4;
  --color-background-warning: #fffbeb;
  --color-background-danger: #fef2f2;
  --color-border-primary: rgba(0,0,0,0.4);
  --color-border-secondary: rgba(0,0,0,0.3);
  --color-border-tertiary: rgba(0,0,0,0.15);
  --color-border-info: #2563eb;${SHARED_VARS}
}`;

// Custom palettes only diverge in the structural surface/text tokens — they inherit
// the base dark/light semantic colors, borders, and SVG ramps. Appended after the base
// :root so these win. Built from the shared palette tokens (the iframe can't read CSS
// vars); values are our own constants, safe to interpolate.
const paletteOverrideCss = (t: PaletteTokens): string =>
  `:root {
  --color-text-primary: ${t.textPrimary};
  --color-text-secondary: ${t.textSecondary};
  --color-text-tertiary: ${t.textTertiary};
  --color-background-primary: ${t.surface};
  --color-background-secondary: ${t.surfaceSecondary};
  --color-background-tertiary: ${t.surfaceTertiary};
}`;

const PALETTE_OVERRIDE: Partial<Record<Theme, string>> = Object.fromEntries(
  (Object.keys(CUSTOM_PALETTE_TOKENS) as CustomPalette[]).map((p) => [
    p,
    paletteOverrideCss(CUSTOM_PALETTE_TOKENS[p]),
  ]),
);

const BASE_CLASSES = `
  .t { font: 400 14px var(--font-sans); fill: var(--color-text-primary); }
  .ts { font: 400 12px var(--font-sans); fill: var(--color-text-secondary); }
  .th { font: 500 14px var(--font-sans); fill: var(--color-text-primary); }
  .box { fill: var(--color-background-secondary); stroke: var(--color-border-tertiary); }
  .node { cursor: pointer; } .node:hover { opacity: 0.85; }
  .arr { stroke: var(--color-border-secondary); stroke-width: 1.5; fill: none; }
  .leader { stroke: var(--color-text-tertiary); stroke-width: 0.5; stroke-dasharray: 3 2; fill: none; }

  button { background: transparent; border: 0.5px solid var(--color-border-secondary); border-radius: var(--border-radius-md); padding: 6px 14px; font-size: 13px; color: var(--color-text-primary); cursor: pointer; font-family: var(--font-sans); }
  button:hover { background: var(--color-background-secondary); }
  input[type="range"] { -webkit-appearance: none; height: 4px; background: var(--color-border-tertiary); border-radius: 2px; }
  input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--color-background-primary); border: 0.5px solid var(--color-border-secondary); cursor: pointer; }
  select { background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 6px 10px; font-size: 13px; color: var(--color-text-primary); font-family: var(--font-sans); }
  input[type="text"], input[type="number"] { background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 6px 10px; font-size: 13px; color: var(--color-text-primary); font-family: var(--font-sans); }
  * { box-sizing: border-box; margin: 0; font-family: var(--font-sans); }
  body { background: transparent; color: var(--color-text-primary); line-height: 1.5; padding: 1rem; }
`;

const SVG_RAMP_LIGHT = `
  .c-purple > rect, .c-purple > circle, .c-purple > ellipse { fill: #EEEDFE; stroke: #534AB7; }
  .c-purple > .th { fill: #3C3489; } .c-purple > .ts { fill: #534AB7; }
  .c-teal > rect, .c-teal > circle, .c-teal > ellipse { fill: #E1F5EE; stroke: #0F6E56; }
  .c-teal > .th { fill: #085041; } .c-teal > .ts { fill: #0F6E56; }
  .c-coral > rect, .c-coral > circle, .c-coral > ellipse { fill: #FAECE7; stroke: #993C1D; }
  .c-coral > .th { fill: #712B13; } .c-coral > .ts { fill: #993C1D; }
  .c-pink > rect, .c-pink > circle, .c-pink > ellipse { fill: #FBEAF0; stroke: #993556; }
  .c-pink > .th { fill: #72243E; } .c-pink > .ts { fill: #993556; }
  .c-gray > rect, .c-gray > circle, .c-gray > ellipse { fill: #F1EFE8; stroke: #5F5E5A; }
  .c-gray > .th { fill: #444441; } .c-gray > .ts { fill: #5F5E5A; }
  .c-blue > rect, .c-blue > circle, .c-blue > ellipse { fill: #E6F1FB; stroke: #185FA5; }
  .c-blue > .th { fill: #0C447C; } .c-blue > .ts { fill: #185FA5; }
  .c-green > rect, .c-green > circle, .c-green > ellipse { fill: #EAF3DE; stroke: #3B6D11; }
  .c-green > .th { fill: #27500A; } .c-green > .ts { fill: #3B6D11; }
  .c-amber > rect, .c-amber > circle, .c-amber > ellipse { fill: #FAEEDA; stroke: #854F0B; }
  .c-amber > .th { fill: #633806; } .c-amber > .ts { fill: #854F0B; }
  .c-red > rect, .c-red > circle, .c-red > ellipse { fill: #FCEBEB; stroke: #A32D2D; }
  .c-red > .th { fill: #791F1F; } .c-red > .ts { fill: #A32D2D; }
`;

const SVG_RAMP_DARK = `
  .c-purple > rect, .c-purple > circle, .c-purple > ellipse { fill: #3C3489; stroke: #AFA9EC; }
  .c-purple > .th { fill: #CECBF6; } .c-purple > .ts { fill: #AFA9EC; }
  .c-teal > rect, .c-teal > circle, .c-teal > ellipse { fill: #085041; stroke: #5DCAA5; }
  .c-teal > .th { fill: #9FE1CB; } .c-teal > .ts { fill: #5DCAA5; }
  .c-coral > rect, .c-coral > circle, .c-coral > ellipse { fill: #712B13; stroke: #F0997B; }
  .c-coral > .th { fill: #F5C4B3; } .c-coral > .ts { fill: #F0997B; }
  .c-pink > rect, .c-pink > circle, .c-pink > ellipse { fill: #72243E; stroke: #ED93B1; }
  .c-pink > .th { fill: #F4C0D1; } .c-pink > .ts { fill: #ED93B1; }
  .c-gray > rect, .c-gray > circle, .c-gray > ellipse { fill: #444441; stroke: #B4B2A9; }
  .c-gray > .th { fill: #D3D1C7; } .c-gray > .ts { fill: #B4B2A9; }
  .c-blue > rect, .c-blue > circle, .c-blue > ellipse { fill: #0C447C; stroke: #85B7EB; }
  .c-blue > .th { fill: #B5D4F4; } .c-blue > .ts { fill: #85B7EB; }
  .c-green > rect, .c-green > circle, .c-green > ellipse { fill: #27500A; stroke: #97C459; }
  .c-green > .th { fill: #C0DD97; } .c-green > .ts { fill: #97C459; }
  .c-amber > rect, .c-amber > circle, .c-amber > ellipse { fill: #633806; stroke: #EF9F27; }
  .c-amber > .th { fill: #FAC775; } .c-amber > .ts { fill: #EF9F27; }
  .c-red > rect, .c-red > circle, .c-red > ellipse { fill: #791F1F; stroke: #F09595; }
  .c-red > .th { fill: #F7C1C1; } .c-red > .ts { fill: #F09595; }
`;

const INITIAL_IFRAME_HEIGHT = 200;
const VISUALIZER_FRAME_PATH = '/visualizer-frame.html';
const VISUALIZER_INIT_EVENT = 'visualizer-html';
const VISUALIZER_RESIZE_EVENT = 'visualizer-resize';
// Throttle resize messages from the iframe to avoid flooding the parent during streaming.
const RESIZE_THROTTLE_MS = 60;
const HEIGHT_REPORTER = `<script>(function(){var last=0,h=0,tid=0;function send(){tid=0;last=Date.now();parent.postMessage({type:'${VISUALIZER_RESIZE_EVENT}',height:h},'*')}new ResizeObserver(function(){var n=document.documentElement.scrollHeight;if(n!==h){h=n;var now=Date.now();if(now-last>=${RESIZE_THROTTLE_MS}){clearTimeout(tid);send()}else if(!tid){tid=setTimeout(send,${RESIZE_THROTTLE_MS}-(now-last))}}}).observe(document.body)})()</script>`;

function buildFrameHtml(code: string, isDark: boolean, theme: Theme): string {
  const colorScheme = isDark ? 'dark' : 'light';
  const themeCSS = isDark ? THEME_CSS_DARK : THEME_CSS_LIGHT;
  const override = PALETTE_OVERRIDE[theme] ?? '';
  const rampClasses = isDark ? SVG_RAMP_DARK : SVG_RAMP_LIGHT;
  return `<html style="color-scheme:${colorScheme}"><head><style>${themeCSS}\n${override}\n${BASE_CLASSES}\n${rampClasses}</style></head><body>${code}${HEIGHT_REPORTER}</body></html>`;
}

export const VisualWidget = memo(function VisualWidget({ code }: VisualWidgetProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeHeight, setIframeHeight] = useState(INITIAL_IFRAME_HEIGHT);
  const [isFrameLoaded, setIsFrameLoaded] = useState(false);
  const resolvedTheme = useResolvedTheme();
  const theme = useUIStore((state) => state.theme);
  const isDark = resolvedTheme === 'dark';
  // theme is a dep so dark↔dim and light↔sepia recompute (both share an isDark value)
  const iframeHtml = useMemo(() => buildFrameHtml(code, isDark, theme), [code, isDark, theme]);

  useEffect(() => {
    if (!isFrameLoaded || !iframeRef.current?.contentWindow) {
      return;
    }

    iframeRef.current.contentWindow.postMessage(
      { type: VISUALIZER_INIT_EVENT, html: iframeHtml },
      '*',
    );
  }, [iframeHtml, isFrameLoaded]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.source === iframeRef.current?.contentWindow &&
        event.data?.type === VISUALIZER_RESIZE_EVENT &&
        typeof event.data.height === 'number'
      ) {
        setIframeHeight(event.data.height);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  return (
    <div className={styles['visual-widget']}>
      <iframe
        ref={iframeRef}
        title="visualization"
        src={VISUALIZER_FRAME_PATH}
        sandbox="allow-scripts allow-same-origin"
        className={styles.frame}
        style={{ height: `${iframeHeight}px` }}
        onLoad={() => setIsFrameLoaded(true)}
      />
    </div>
  );
});
