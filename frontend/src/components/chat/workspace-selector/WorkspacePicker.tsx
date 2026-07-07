import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { FolderOpen, Search, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader';
import type { Workspace } from '@/types/workspace.types';
import { WorkspaceItem } from './WorkspaceItem';

const SEARCH_THRESHOLD = 5;

interface WorkspacePickerProps {
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  onSelect: (id: string) => void;
  // Shows "Loading…" in the trigger while the workspace list is in flight (cloud).
  isLoading?: boolean;
  // Disables the trigger when there's nothing to pick yet (cloud loading/empty).
  triggerDisabled?: boolean;
  // Local-only git branch sub-row on each item; cloud workspaces have no reachable sandbox.
  showBranches: boolean;
  // Creation flows rendered below the list (local only). Receives `close` so a
  // freshly-created workspace can dismiss the modal.
  footer?: (close: () => void) => ReactNode;
}

export function WorkspacePicker({
  workspaces,
  selectedWorkspaceId,
  onSelect,
  isLoading = false,
  triggerDisabled = false,
  showBranches,
  footer,
}: WorkspacePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedWorkspace = workspaces.find((ws) => ws.id === selectedWorkspaceId);
  const showSearch = workspaces.length > SEARCH_THRESHOLD;

  const visibleWorkspaces = useMemo(() => {
    if (!searchQuery) return workspaces;
    const query = searchQuery.toLowerCase();
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(query));
  }, [workspaces, searchQuery]);

  const close = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
  }, []);

  const selectWorkspace = useCallback(
    (workspace: Workspace) => {
      onSelect(workspace.id);
      close();
    },
    [onSelect, close],
  );

  const label = selectedWorkspace?.name ?? (isLoading ? 'Loading…' : 'Select workspace');

  return (
    <>
      <Button
        variant="unstyled"
        type="button"
        disabled={triggerDisabled}
        onClick={() => setIsOpen(true)}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
      >
        <FolderOpen className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        <span className="max-w-[16rem] truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
      </Button>

      <BaseModal isOpen={isOpen} onClose={close} size="md" ariaLabel="Select workspace">
        <ModalHeader title="Workspaces" onClose={close} />

        <div className="flex flex-col">
          {showSearch && (
            <div className="px-4 pt-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-quaternary dark:text-text-dark-quaternary" />
                <Input
                  variant="unstyled"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search workspaces…"
                  autoFocus
                  className="h-8 w-full rounded-lg border border-border/50 bg-surface-tertiary pl-8 pr-3 text-xs text-text-primary outline-none placeholder:text-text-quaternary focus-visible:border-border-hover dark:border-border-dark/50 dark:bg-surface-dark-secondary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus-visible:border-border-dark-hover"
                />
              </div>
            </div>
          )}

          <div className="max-h-[20rem] overflow-y-auto px-3 py-2">
            {visibleWorkspaces.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
                {searchQuery ? 'No workspaces found' : 'No workspaces yet'}
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {visibleWorkspaces.map((ws) => (
                  <WorkspaceItem
                    key={ws.id}
                    ws={ws}
                    isSelected={ws.id === selectedWorkspaceId}
                    isPickerOpen={isOpen}
                    showBranches={showBranches}
                    onSelect={selectWorkspace}
                  />
                ))}
              </div>
            )}
          </div>

          {footer && (
            <div className="border-t border-border/50 px-4 py-3 dark:border-border-dark/50">
              {footer(close)}
            </div>
          )}
        </div>
      </BaseModal>
    </>
  );
}
