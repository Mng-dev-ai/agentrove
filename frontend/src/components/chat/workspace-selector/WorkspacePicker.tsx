import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { FolderOpen, Search, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader/ModalHeader';
import type { Workspace } from '@/types/workspace.types';
import { WorkspaceItem } from './WorkspaceItem';
import styles from './WorkspacePicker.module.scss';

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
        className={styles.trigger}
      >
        <FolderOpen className={styles['trigger-icon']} />
        <span className={styles['trigger-label']}>{label}</span>
        <ChevronDown className={styles['trigger-icon']} />
      </Button>

      <BaseModal isOpen={isOpen} onClose={close} size="md" ariaLabel="Select workspace">
        <ModalHeader title="Workspaces" onClose={close} />

        <div className={styles.body}>
          {showSearch && (
            <div className={styles['search-section']}>
              <div className={styles['search-field']}>
                <Search className={styles['search-icon']} />
                <Input
                  variant="unstyled"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search workspaces…"
                  autoFocus
                  className={styles['search-input']}
                />
              </div>
            </div>
          )}

          <div className={styles.list}>
            {visibleWorkspaces.length === 0 ? (
              <p className={styles.empty}>
                {searchQuery ? 'No workspaces found' : 'No workspaces yet'}
              </p>
            ) : (
              <div className={styles['list-items']}>
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

          {footer && <div className={styles.footer}>{footer(close)}</div>}
        </div>
      </BaseModal>
    </>
  );
}
