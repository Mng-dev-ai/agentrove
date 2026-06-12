import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Terminal as XTerm } from 'xterm';
import type { FitAddon as FitAddonType } from 'xterm-addon-fit';

import { buildTerminalTheme } from '@/utils/terminal';
import type { TerminalSize } from '@/types/sandbox.types';

type XTermCore = {
  _core?: {
    _renderService?: {
      _renderer?: { value?: unknown };
    };
  };
};

function hasRenderer(terminal: XTerm): boolean {
  return !!(terminal as unknown as XTermCore)._core?._renderService?._renderer?.value;
}

interface UseXtermOptions {
  isVisible: boolean;
  mode: 'light' | 'dark';
  onData: (data: string) => void;
  onFit: (size: TerminalSize) => void;
}

interface UseXtermReturn {
  fitTerminal: () => TerminalSize | null;
  isReady: boolean;
  terminalRef: MutableRefObject<XTerm | null>;
  wrapperRef: MutableRefObject<HTMLDivElement | null>;
}

export const useXterm = ({ isVisible, mode, onData, onFit }: UseXtermOptions): UseXtermReturn => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);
  const inputHandlerRef = useRef<ReturnType<XTerm['onData']> | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [initAttempt, setInitAttempt] = useState(0);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const hasInitializedRef = useRef(false);
  const shouldInitialize = hasInitializedRef.current || isVisible;

  const fitTerminal = useCallback((): TerminalSize | null => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;

    if (!fitAddon || !terminal || !hasRenderer(terminal)) {
      return null;
    }

    try {
      fitAddon.fit();
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('dimensions')) {
        return null;
      }
      throw error;
    }

    const size = {
      rows: terminal.rows,
      cols: terminal.cols,
    };

    onFit(size);

    return size;
  }, [onFit]);

  useEffect(() => {
    if (!shouldInitialize) {
      return undefined;
    }

    const container = wrapperRef.current;
    if (!container || terminalRef.current) {
      return undefined;
    }

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
    let openFrameId: number | null = null;
    let xterm: XTerm | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ]);

      if (cancelled) return;

      xterm = new Terminal({
        scrollback: 1000,
        fontSize: 12,
        fontFamily: 'monospace',
        theme: buildTerminalTheme(modeRef.current),
      });
      const fitAddon = new FitAddon();

      hasInitializedRef.current = true;
      fitAddonRef.current = fitAddon;
      terminalRef.current = xterm;

      xterm.loadAddon(fitAddon);

      const currentXterm = xterm;
      openFrameId = requestAnimationFrame(() => {
        openFrameId = null;
        if (cancelled || !container.isConnected || terminalRef.current !== currentXterm) {
          return;
        }
        try {
          currentXterm.open(container);
          setIsReady(true);
        } catch {
          terminalRef.current = null;
          hasInitializedRef.current = false;
        }
      });
    })();

    return () => {
      cancelled = true;
      if (openFrameId !== null) {
        cancelAnimationFrame(openFrameId);
      }
      inputHandlerRef.current?.dispose();
      inputHandlerRef.current = null;
      fitAddonRef.current = null;
      terminalRef.current = null;
      try {
        xterm?.dispose();
      } catch {
        // Ignore dispose errors
      }
      setIsReady(false);
      hasInitializedRef.current = false;
    };
  }, [shouldInitialize, initAttempt]);

  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    inputHandlerRef.current?.dispose();
    inputHandlerRef.current = terminal.onData(onData);

    return () => {
      inputHandlerRef.current?.dispose();
      inputHandlerRef.current = null;
    };
  }, [onData]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !hasRenderer(terminal)) {
      return;
    }

    try {
      terminal.options.theme = buildTerminalTheme(mode);
    } catch {
      return;
    }

    if (isReady && isVisible) {
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
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
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
      document.fonts?.ready.then(() => {
        if (!cancelled) {
          fitTerminal();
        }
      });
    }

    return () => {
      cancelled = true;
      if (frame) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
    };
  }, [isReady, isVisible, fitTerminal]);

  return useMemo(
    () => ({
      fitTerminal,
      isReady,
      terminalRef,
      wrapperRef,
    }),
    [fitTerminal, isReady],
  );
};
