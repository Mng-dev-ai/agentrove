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

// Write-only OSC 52 — sandbox must not read clipboard via PTY; silent no-op without secure clipboard.
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
  // Set only after open() succeeds — consumers must not touch a missing renderer.
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [initAttempt, setInitAttempt] = useState(0);

  // Refs so open-once / stable fitTerminal don't re-run (and tear down) on re-render.
  const onDataRef = useRef(onData);
  const onFitRef = useRef(onFit);
  const modeRef = useRef(mode);
  onDataRef.current = onData;
  onFitRef.current = onFit;
  modeRef.current = mode;

  const hasInitializedRef = useRef(false);
  // Stay alive through visibility toggles so hidden tabs keep scrollback.
  const shouldInitialize = hasInitializedRef.current || isVisible;

  const fitTerminal = useCallback((): TerminalSize | null => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!fitAddon || !terminal) {
      return null;
    }

    // Skip zero-size wrappers — would resize to a garbage grid.
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

    // Wait for real dimensions — open into zero-size measures a broken cell grid.
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

      // Measure cells against Nerd Font glyphs, not the cold-load fallback.
      try {
        await document.fonts?.load('12px "JetBrainsMono Nerd Font"');
      } catch {
        // Open anyway; text falls back to monospace.
      }

      if (cancelled || !container.isConnected) {
        return;
      }

      xterm = new Terminal({
        // Search decorations use registerDecoration (still a proposed API).
        allowProposedApi: true,
        // No alternate screen (tmux smcup@) — this is scroll/search history.
        scrollback: 10000,
        fontSize: 14,
        // Nerd Font for PUA icons; monospace only as last-resort fallback.
        fontFamily: '"JetBrainsMono Nerd Font", monospace',
        theme: buildTerminalTheme(modeRef.current),
      });
      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      const searchAddon = new SearchAddon();
      xterm.loadAddon(searchAddon);
      // OSC 52 write path for vim/tmux copy-mode → navigator.clipboard.
      xterm.loadAddon(new ClipboardAddon(undefined, WRITE_ONLY_CLIPBOARD));
      xterm.onData((data) => onDataRef.current(data));
      xterm.open(container);

      hasInitializedRef.current = true;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;
      terminalRef.current = xterm;
      setIsReady(true);
    })().catch((error: unknown) => {
      // Overlay stays on "Initializing"; remount retries from scratch.
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
      // Palette can nudge cell metrics; refit after theme swap settles.
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
