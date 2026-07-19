import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { IClipboardProvider } from '@xterm/addon-clipboard';
import type { SearchAddon } from '@xterm/addon-search';

import { logger } from '@/utils/logger';
import { buildTerminalTheme } from '@/utils/terminal';
import type { TerminalSize } from '@/types/sandbox.types';
import type { Palette } from '@/types/ui.types';

// Write-only OSC 52: an OSC 52 query ('?') from a sandbox process must not be
// able to read the user's clipboard back through the PTY — tmux copy-mode
// only needs the write direction. navigator.clipboard is undefined in
// non-secure contexts (self-hosted plain-http), so degrade to a silent no-op.
const WRITE_ONLY_CLIPBOARD: IClipboardProvider = {
  readText: () => Promise.resolve(''),
  writeText: (selection, text) =>
    selection === 'c' && navigator.clipboard
      ? navigator.clipboard.writeText(text)
      : Promise.resolve(),
};

interface UseXtermOptions {
  isVisible: boolean;
  mode: Palette;
  onData: (data: string) => void;
  onFit: (size: TerminalSize) => void;
}

interface UseXtermReturn {
  fitTerminal: () => TerminalSize | null;
  isReady: boolean;
  searchAddonRef: MutableRefObject<SearchAddon | null>;
  terminalRef: MutableRefObject<XTerm | null>;
  wrapperRef: MutableRefObject<HTMLDivElement | null>;
}

export const useXterm = ({ isVisible, mode, onData, onFit }: UseXtermOptions): UseXtermReturn => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Assigned only after open() succeeds, so consumers (fit, theme, writes)
  // never touch a terminal whose renderer doesn't exist yet.
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [initAttempt, setInitAttempt] = useState(0);

  // Route callbacks/theme through refs so the open-once effect and the stable
  // fitTerminal don't re-run (tearing down the terminal) on parent re-renders.
  const onDataRef = useRef(onData);
  const onFitRef = useRef(onFit);
  const modeRef = useRef(mode);
  onDataRef.current = onData;
  onFitRef.current = onFit;
  modeRef.current = mode;

  const hasInitializedRef = useRef(false);
  // Once created, keep the terminal alive through visibility toggles so a
  // hidden tab doesn't lose its scrollback.
  const shouldInitialize = hasInitializedRef.current || isVisible;

  const fitTerminal = useCallback((): TerminalSize | null => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!fitAddon || !terminal) {
      return null;
    }

    // proposeDimensions returns undefined/NaN while the wrapper has no size
    // (hidden tab, mid-layout) — skip instead of resizing to a garbage grid.
    const proposed = fitAddon.proposeDimensions();
    if (!proposed || !Number.isFinite(proposed.rows) || !Number.isFinite(proposed.cols)) {
      return null;
    }

    fitAddon.fit();
    const size = { rows: terminal.rows, cols: terminal.cols };
    onFitRef.current(size);
    return size;
  }, []);

  useEffect(() => {
    if (!shouldInitialize) {
      return undefined;
    }

    const container = wrapperRef.current;
    if (!container || terminalRef.current) {
      return undefined;
    }

    // Opening xterm into a zero-size element makes the renderer measure a
    // broken cell grid — wait for the wrapper to gain real dimensions first.
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          observer.disconnect();
          setInitAttempt((c) => c + 1);
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    }

    let cancelled = false;
    let xterm: XTerm | null = null;

    void (async () => {
      const [{ Terminal }, { FitAddon }, { ClipboardAddon }, { SearchAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-clipboard'),
        import('@xterm/addon-search'),
      ]);

      // Wait for the Nerd Font before first paint so the renderer measures
      // cell dimensions against the real glyphs, not the fallback (cold load).
      try {
        await document.fonts?.load('12px "JetBrainsMono Nerd Font"');
      } catch {
        // Font unavailable — open anyway; text falls back to monospace.
      }

      if (cancelled || !container.isConnected) {
        return;
      }

      xterm = new Terminal({
        // The search addon's match decorations use registerDecoration, which
        // xterm still gates as a proposed API.
        allowProposedApi: true,
        // tmux attaches without the alternate screen (smcup@ override), so this
        // buffer is the scroll/search history — sized to tmux's history-limit.
        scrollback: 10000,
        fontSize: 14,
        // Nerd Font primary so PUA icon glyphs (eza/ls icons, Starship prompt
        // symbols) render; generic monospace is only a last-resort fallback.
        fontFamily: '"JetBrainsMono Nerd Font", monospace',
        theme: buildTerminalTheme(modeRef.current),
      });
      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      const searchAddon = new SearchAddon();
      xterm.loadAddon(searchAddon);
      // OSC 52 → system clipboard: inner apps (vim, keyboard copy-mode) copy
      // through tmux's set-clipboard/Ms path and must reach navigator.clipboard.
      xterm.loadAddon(new ClipboardAddon(undefined, WRITE_ONLY_CLIPBOARD));
      // Registered once for the terminal's lifetime; dispose() cleans it up.
      xterm.onData((data) => onDataRef.current(data));
      xterm.open(container);

      hasInitializedRef.current = true;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;
      terminalRef.current = xterm;
      setIsReady(true);
    })().catch((error: unknown) => {
      // Chunk-load or open() failure — the overlay stays on "Initializing",
      // and remounting the tab retries from scratch.
      logger.error('Terminal initialization failed', 'useXterm', error);
    });

    return () => {
      cancelled = true;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      terminalRef.current = null;
      xterm?.dispose();
      setIsReady(false);
      hasInitializedRef.current = false;
    };
  }, [shouldInitialize, initAttempt]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return undefined;
    }

    terminal.options.theme = buildTerminalTheme(mode);

    if (isVisible) {
      // Refit after the theme swap settles — palette changes can nudge cell
      // metrics via the renderer's measured styles.
      const frame = requestAnimationFrame(() => {
        fitTerminal();
      });
      return () => cancelAnimationFrame(frame);
    }

    return undefined;
  }, [mode, isReady, isVisible, fitTerminal]);

  useEffect(() => {
    const container = wrapperRef.current;
    if (!container || !isReady) {
      return undefined;
    }

    let frame: number | null = null;
    let cancelled = false;

    const scheduleFit = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!cancelled) {
          fitTerminal();
        }
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      if (isVisible) {
        scheduleFit();
      }
    });
    resizeObserver.observe(container);

    if (isVisible) {
      scheduleFit();
      // Late font loads change glyph metrics — refit once everything settled.
      void document.fonts?.ready.then(() => {
        if (!cancelled) {
          fitTerminal();
        }
      });
    }

    return () => {
      cancelled = true;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
    };
  }, [isReady, isVisible, fitTerminal]);

  return useMemo(
    () => ({
      fitTerminal,
      isReady,
      searchAddonRef,
      terminalRef,
      wrapperRef,
    }),
    [fitTerminal, isReady],
  );
};
