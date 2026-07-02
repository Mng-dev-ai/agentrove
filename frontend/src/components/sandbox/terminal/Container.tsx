import { useState, useCallback, useEffect, useRef } from 'react';
import type { FC } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { TerminalTab } from './TerminalTab';
import { cn } from '@/utils/cn';
import { terminalStorageKey } from '@/utils/terminal';

export interface ContainerProps {
  sandboxId?: string;
  chatId?: string;
  isVisible: boolean;
  panelKey: string;
}

interface TerminalInstance {
  id: string;
  label: string;
}

export const Container: FC<ContainerProps> = ({ sandboxId, chatId, isVisible, panelKey }) => {
  const defaultTerminalId = `terminal-${panelKey}-1`;
  const storageKey = chatId ? terminalStorageKey(chatId, panelKey) : null;
  const [terminals, setTerminals] = useState<TerminalInstance[]>([
    { id: defaultTerminalId, label: 'Terminal 1' },
  ]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>(defaultTerminalId);
  const [closingTerminalIds, setClosingTerminalIds] = useState<Set<string>>(() => new Set());
  const isRestoringRef = useRef(true);

  useEffect(() => {
    isRestoringRef.current = true;
    const defaultTerminals = [{ id: defaultTerminalId, label: 'Terminal 1' }];

    let nextTerminals = defaultTerminals;
    let nextActiveId = defaultTerminalId;

    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as {
            terminals?: TerminalInstance[];
            activeTerminalId?: string;
          };
          const valid = parsed.terminals?.filter((terminal) => terminal.id && terminal.label) ?? [];
          if (valid.length > 0) {
            nextTerminals = valid;
            nextActiveId =
              parsed.activeTerminalId &&
              valid.some((terminal) => terminal.id === parsed.activeTerminalId)
                ? parsed.activeTerminalId
                : (valid[0]?.id ?? defaultTerminalId);
          }
        } catch {
          // corrupt storage, use defaults
        }
      }
    }

    setTerminals(nextTerminals);
    setActiveTerminalId(nextActiveId);
    isRestoringRef.current = false;
  }, [storageKey, defaultTerminalId]);

  useEffect(() => {
    if (!storageKey || isRestoringRef.current) {
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify({ terminals, activeTerminalId }));
  }, [storageKey, terminals, activeTerminalId]);

  const addTerminal = useCallback(() => {
    setTerminals((prev) => {
      const existingNumbers = new Set(prev.map((t) => parseInt(t.id.split('-').pop() || '0', 10)));

      let nextNumber = 1;
      while (existingNumbers.has(nextNumber)) {
        nextNumber += 1;
      }

      const newTerminal: TerminalInstance = {
        id: `terminal-${panelKey}-${nextNumber}`,
        label: `Terminal ${prev.length + 1}`,
      };

      setActiveTerminalId(newTerminal.id);
      return [...prev, newTerminal];
    });
  }, [panelKey]);

  const closeTerminal = useCallback((terminalId: string) => {
    setClosingTerminalIds((prev) => {
      const next = new Set(prev);
      next.add(terminalId);
      return next;
    });
  }, []);

  const finalizeCloseTerminal = useCallback(
    (terminalId: string) => {
      setTerminals((prev) => {
        const filtered = prev.filter((t) => t.id !== terminalId);
        if (filtered.length === 0) {
          setActiveTerminalId(defaultTerminalId);
          return [{ id: defaultTerminalId, label: 'Terminal 1' }];
        }

        setActiveTerminalId((current) => {
          if (current === terminalId) {
            const currentIndex = prev.findIndex((t) => t.id === terminalId);
            const nextTerminal = prev[currentIndex - 1] || prev[currentIndex + 1];
            return nextTerminal?.id || filtered[0]?.id || defaultTerminalId;
          }
          return current;
        });

        return filtered.map((t, i) => ({ ...t, label: `Terminal ${i + 1}` }));
      });
      setClosingTerminalIds((prev) => {
        const next = new Set(prev);
        next.delete(terminalId);
        return next;
      });
    },
    [defaultTerminalId],
  );

  return (
    <div className="flex h-full w-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
      <div
        className="flex h-9 items-center border-b border-border/50 dark:border-border-dark/50"
        role="tablist"
      >
        {terminals.map((terminal) => (
          <Button
            variant="unstyled"
            key={terminal.id}
            className={cn(
              'group flex h-full items-center gap-1.5 border-r border-border/30 px-3 font-mono text-2xs transition-colors duration-200 dark:border-border-dark/30',
              activeTerminalId === terminal.id
                ? 'bg-surface-secondary text-text-primary dark:bg-surface-dark-secondary dark:text-text-dark-primary'
                : 'text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary',
            )}
            onClick={() => setActiveTerminalId(terminal.id)}
            role="tab"
            aria-selected={activeTerminalId === terminal.id}
          >
            <span>{terminal.label}</span>
            {terminals.length > 1 && (
              <span
                className="rounded p-0.5 text-text-quaternary opacity-0 transition-opacity duration-150 hover:text-text-primary group-hover:opacity-100 dark:hover:text-text-dark-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(terminal.id);
                }}
                role="button"
                aria-label="Close terminal"
              >
                <X className="h-2.5 w-2.5" />
              </span>
            )}
          </Button>
        ))}
        <Button
          variant="unstyled"
          className="flex h-full items-center px-2 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
          onClick={addTerminal}
          aria-label="Add new terminal"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`absolute inset-0 ${activeTerminalId === terminal.id ? 'block' : 'hidden'}`}
          >
            <TerminalTab
              isVisible={isVisible && activeTerminalId === terminal.id}
              sandboxId={sandboxId}
              terminalId={terminal.id}
              shouldClose={closingTerminalIds.has(terminal.id)}
              onClosed={() => finalizeCloseTerminal(terminal.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
