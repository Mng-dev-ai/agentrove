import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cloud, FolderOpen, Search, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { useDropdown } from '@/hooks/useDropdown';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { useCloudWorkspacesQuery } from '@/hooks/queries/useCloudQueries';

const SEARCH_THRESHOLD = 8;

interface CloudWorkspaceSelectorProps {
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (id: string) => void;
  disabled?: boolean;
}

// Shown on the landing composer when running on cloud: pick a workspace that
// exists on the VPS, or prompt the user to connect a cloud instance first.
// Styled to match the local workspace selector trigger.
export function CloudWorkspaceSelector({
  selectedWorkspaceId,
  onWorkspaceChange,
  disabled = false,
}: CloudWorkspaceSelectorProps) {
  const navigate = useNavigate();
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  const isConnected = !!connectedEmail;
  const { data: workspaces = [], isLoading, error } = useCloudWorkspacesQuery(isConnected);
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const [searchQuery, setSearchQuery] = useState('');

  // Default to the first VPS workspace once the list loads and none is chosen.
  useEffect(() => {
    if (!workspaces.length) return;
    if (selectedWorkspaceId && workspaces.some((ws) => ws.id === selectedWorkspaceId)) return;
    onWorkspaceChange(workspaces[0].id);
  }, [workspaces, selectedWorkspaceId, onWorkspaceChange]);

  const visibleWorkspaces = useMemo(() => {
    if (!searchQuery) return workspaces;
    const query = searchQuery.toLowerCase();
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(query));
  }, [workspaces, searchQuery]);

  if (!isConnected) {
    return (
      <Button
        type="button"
        variant="unstyled"
        onClick={() => navigate('/settings', { state: { tab: 'cloud' } })}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
      >
        <Cloud className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        Connect a cloud instance
      </Button>
    );
  }

  if (error) {
    return (
      <span className="px-1.5 py-1 text-2xs text-error-600 dark:text-error-400">
        Couldn&apos;t reach cloud instance
      </span>
    );
  }

  const selectedWorkspace = workspaces.find((ws) => ws.id === selectedWorkspaceId);
  const label = selectedWorkspace?.name ?? (isLoading ? 'Loading…' : 'Select workspace');

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="unstyled"
        type="button"
        disabled={disabled || isLoading || workspaces.length === 0}
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
      >
        <FolderOpen className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        <span className="max-w-[16rem] truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
      </Button>

      {isOpen && (
        <div className="absolute left-0 top-full z-[60] mt-1 w-64 rounded-xl border border-border bg-surface-secondary/95 py-1 shadow-medium backdrop-blur-xl backdrop-saturate-150 dark:border-border-dark dark:bg-surface-dark-secondary/95 dark:shadow-black/40">
          {workspaces.length > SEARCH_THRESHOLD && (
            <div className="border-b border-border/50 px-1.5 pb-1.5 dark:border-border-dark/50">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2 h-3 w-3 text-text-quaternary dark:text-text-dark-quaternary" />
                <Input
                  variant="unstyled"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search workspaces…"
                  className="h-7 w-full bg-transparent pl-7 text-2xs text-text-primary placeholder:text-text-quaternary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary"
                />
              </div>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            {visibleWorkspaces.length === 0 ? (
              <p className="px-2.5 py-2 text-center text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                No workspaces found
              </p>
            ) : (
              visibleWorkspaces.map((ws) => (
                <Button
                  variant="unstyled"
                  key={ws.id}
                  type="button"
                  onClick={() => {
                    onWorkspaceChange(ws.id);
                    setSearchQuery('');
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-2xs transition-colors duration-150 ${
                    ws.id === selectedWorkspaceId
                      ? 'bg-surface-hover/80 text-text-primary dark:bg-surface-dark-hover/80 dark:text-text-dark-primary'
                      : 'text-text-secondary hover:bg-surface-hover/50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover/50'
                  }`}
                >
                  <Check
                    className={`h-3 w-3 shrink-0 ${ws.id === selectedWorkspaceId ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <span className="truncate" title={ws.name}>
                    {ws.name}
                  </span>
                </Button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
