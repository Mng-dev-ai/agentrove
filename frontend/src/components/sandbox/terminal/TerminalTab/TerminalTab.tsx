import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { logger } from '@/utils/logger';
import 'xterm/css/xterm.css';

import { Button } from '@/components/ui/primitives/Button/Button';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useUIStore } from '@/store/uiStore';
import { resolveSandboxClient, resolveSandboxWs } from '@/lib/api';

import { useXterm } from '@/hooks/useXterm';
import type { TerminalSize } from '@/types/sandbox.types';
import type { Palette } from '@/types/ui.types';
import styles from './TerminalTab.module.scss';

export interface TerminalTabProps {
  isVisible: boolean;
  sandboxId?: string;
  terminalId?: string;
  // Workspace-relative shell start dir (the chat's worktree); root when unset.
  cwd?: string;
  shouldClose?: boolean;
  onClosed?: () => void;
}

type SessionState = 'idle' | 'connecting' | 'ready' | 'error' | 'disconnected';

const encoder = new TextEncoder();

// Mirrors backend WS_CLOSE_* codes in app/constants.py
const WS_CLOSE_AUTH_FAILED = 4001;
const WS_CLOSE_SANDBOX_NOT_FOUND = 4004;
const WS_CLOSE_INVALID_CWD = 4005;

export function TerminalTab({
  isVisible,
  sandboxId,
  terminalId,
  cwd,
  shouldClose = false,
  onClosed,
}: TerminalTabProps) {
  const resolvedTheme = useResolvedTheme();
  const rawTheme = useUIStore((s) => s.theme);
  // Only `system` needs resolving; every other theme is itself a palette
  const palette: Palette = rawTheme === 'system' ? resolvedTheme : rawTheme;
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [connectAttempt, setConnectAttempt] = useState(0);

  const lastSentSizeRef = useRef<TerminalSize | null>(null);
  const hasSentInitRef = useRef(false);
  const focusOnNextWriteRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const isClosingRef = useRef(false);
  const isVisibleRef = useRef(isVisible);
  const shouldCloseRef = useRef(shouldClose);

  const resetWsRefs = useCallback(() => {
    wsRef.current = null;
    hasSentInitRef.current = false;
    focusOnNextWriteRef.current = false;
    lastSentSizeRef.current = null;
  }, []);

  const handleFit = useCallback((size: TerminalSize) => {
    if (!hasSentInitRef.current) {
      return;
    }

    const ws = wsRef.current;
    const lastSent = lastSentSizeRef.current;

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      (lastSent && lastSent.rows === size.rows && lastSent.cols === size.cols)
    ) {
      return;
    }

    ws.send(JSON.stringify({ type: 'resize', rows: size.rows, cols: size.cols }));
    lastSentSizeRef.current = size;
  }, []);

  const { fitTerminal, isReady, terminalRef, wrapperRef } = useXterm({
    isVisible,
    mode: palette,
    onData: (data: string) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data));
      }
    },
    onFit: handleFit,
  });

  shouldCloseRef.current = shouldClose;
  isVisibleRef.current = isVisible;

  useEffect(() => {
    if (!sandboxId || !isReady) return;

    // Reset on every (re)connect so stale screen contents and cursor position
    // do not leak into the next PTY — the server repaints via tmux on reattach.
    terminalRef.current?.reset();

    // Route to the cloud VPS WS host when the sandbox lives there, else local.
    const baseUrl = resolveSandboxWs(sandboxId);

    const params = new URLSearchParams();
    if (terminalId) params.set('terminalId', terminalId);
    if (cwd) params.set('cwd', cwd);
    const query = params.toString();
    const wsUrl = `${baseUrl}/${sandboxId}/terminal${query ? `?${query}` : ''}`;

    setSessionState('connecting');
    setCloseReason(null);

    let cancelled = false;
    let teardown: (() => void) | null = null;

    const connect = (token: string) => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      hasSentInitRef.current = false;
      focusOnNextWriteRef.current = true;
      lastSentSizeRef.current = null;

      const handleOpen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }));

        const size =
          fitTerminal() ??
          (terminalRef.current
            ? { rows: terminalRef.current.rows, cols: terminalRef.current.cols }
            : { rows: 24, cols: 80 });

        ws.send(JSON.stringify({ type: 'init', rows: size.rows, cols: size.cols }));
        hasSentInitRef.current = true;
        lastSentSizeRef.current = size;
      };

      const handleMessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') {
          return;
        }
        try {
          const message = JSON.parse(event.data) as Record<string, unknown>;
          // Server ping is a NAT/LB keepalive — no pong is expected.
          if (message.type === 'ping') {
            return;
          }
          if (message.type === 'stdout' && typeof message.data === 'string') {
            const terminal = terminalRef.current;
            const focusAfterWrite = focusOnNextWriteRef.current;
            focusOnNextWriteRef.current = false;
            terminal?.write(
              message.data,
              focusAfterWrite
                ? () => {
                    // Reattached tmux modes must be parsed before focus so TUIs
                    // receive the focus event and paint without a user click.
                    if (wsRef.current !== ws) {
                      return;
                    }
                    terminal.refresh(0, terminal.rows - 1);
                    if (isVisibleRef.current) {
                      terminal.focus();
                    }
                  }
                : undefined,
            );
            setSessionState((prev) => (prev === 'connecting' ? 'ready' : prev));
            return;
          }
          if (message.type === 'init') {
            const rows = typeof message.rows === 'number' ? message.rows : undefined;
            const cols = typeof message.cols === 'number' ? message.cols : undefined;
            if (rows && cols) {
              lastSentSizeRef.current = { rows, cols };
            }
            setSessionState('ready');
          }
        } catch (error) {
          logger.error('Terminal write failed', 'TerminalTab', error);
        }
      };

      const handleError = () => {
        setSessionState('error');
      };

      const handleClose = (event: CloseEvent) => {
        resetWsRefs();
        // User-initiated tab close tears the socket down on purpose — don't
        // surface that as an unexpected disconnect.
        if (isClosingRef.current) {
          return;
        }
        // The server closes with WS_CLOSE_AUTH_FAILED / WS_CLOSE_SANDBOX_NOT_FOUND
        // and a human-readable reason. Surface both so the overlay can tell the
        // user why the connection dropped instead of showing a generic message.
        if (
          event.code === WS_CLOSE_AUTH_FAILED ||
          event.code === WS_CLOSE_SANDBOX_NOT_FOUND ||
          event.code === WS_CLOSE_INVALID_CWD
        ) {
          setCloseReason(event.reason || null);
          setSessionState('error');
          return;
        }
        // Any other close while this effect is live (backend restart, network
        // drop) is unexpected — offer a reconnect instead of a frozen terminal.
        setSessionState((prev) => (prev === 'error' ? prev : 'disconnected'));
      };

      const handleBeforeUnload = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'detach' }));
        }
        ws.close();
      };

      ws.addEventListener('open', handleOpen);
      ws.addEventListener('message', handleMessage);
      ws.addEventListener('error', handleError);
      ws.addEventListener('close', handleClose);
      window.addEventListener('beforeunload', handleBeforeUnload);

      teardown = () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        ws.removeEventListener('open', handleOpen);
        ws.removeEventListener('message', handleMessage);
        ws.removeEventListener('error', handleError);
        ws.removeEventListener('close', handleClose);

        if (!shouldCloseRef.current && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'detach' }));
        }
        ws.close();
        resetWsRefs();
      };
    };

    // Mint a fresh token instead of reading the cached one — the cloud access
    // token lives only in memory, so it's absent right after a page reload.
    void resolveSandboxClient(sandboxId)
      .getValidToken()
      .then((token) => {
        if (cancelled) return;
        if (!token) {
          // Route the null-token case through the catch so both auth
          // failures share one error path.
          throw new Error('Missing terminal auth token');
        }
        connect(token);
      })
      .catch((error) => {
        if (!cancelled) {
          logger.error('Terminal auth token mint failed', 'TerminalTab', error);
          setSessionState('error');
          setCloseReason('Terminal authentication failed');
        }
      });

    return () => {
      cancelled = true;
      teardown?.();
      setSessionState('idle');
    };
  }, [sandboxId, terminalId, cwd, isReady, connectAttempt, fitTerminal, terminalRef, resetWsRefs]);

  useEffect(() => {
    if (!shouldClose || isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'close' }));
    }
    ws?.close();
    resetWsRefs();
    setSessionState('idle');
    onClosed?.();
  }, [shouldClose, onClosed, resetWsRefs]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    requestAnimationFrame(() => {
      terminalRef.current?.focus();
    });
  }, [isVisible, terminalRef]);

  const overlayMessage = !isReady
    ? 'Initializing terminal...'
    : sessionState === 'connecting'
      ? 'Connecting to sandbox terminal...'
      : sessionState === 'error'
        ? (closeReason ?? 'Terminal connection interrupted')
        : sessionState === 'disconnected'
          ? 'Terminal disconnected'
          : null;

  return (
    <div className={styles['terminal-tab']}>
      <div className={styles['terminal-tab-body']}>
        <div
          ref={wrapperRef}
          className={clsx(
            styles['terminal-surface'],
            !isVisible && styles['terminal-surface--hidden'],
          )}
        />
      </div>
      {isVisible && overlayMessage && (
        <div className={styles['terminal-overlay']}>
          <div className={styles['terminal-overlay-message']}>{overlayMessage}</div>
          {sessionState === 'disconnected' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConnectAttempt((attempt) => attempt + 1)}
            >
              Reconnect
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
