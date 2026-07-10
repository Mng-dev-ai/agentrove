import { useCallback, useMemo, useRef, useState } from 'react';
import type { CustomSkill } from '@/types/user.types';
import type { AgentKind } from '@/types/chat.types';
import { fuzzySearch } from '@/utils/fuzzySearch';

// Chip order for the source filter — typed against AgentKind so it can't drift
// from the canonical provider set if a kind is added, removed, or renamed.
const SOURCE_ORDER: AgentKind[] = ['claude', 'codex', 'copilot', 'cursor', 'grok', 'opencode'];

export function useSkillsFilter(items: CustomSkill[], workspaceId: string | undefined) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set());

  // Clear the search when the workspace changes so a query from one workspace
  // doesn't carry into the next.
  const prevWorkspaceRef = useRef(workspaceId);
  if (prevWorkspaceRef.current !== workspaceId) {
    prevWorkspaceRef.current = workspaceId;
    setSearchQuery('');
  }

  // Only offer chips for sources actually present in the current skills.
  const availableSources = useMemo<string[]>(() => {
    const present = new Set<string>();
    for (const skill of items) {
      for (const source of skill.sources) present.add(source);
    }
    return SOURCE_ORDER.filter((source) => present.has(source));
  }, [items]);

  // Drop active filters whose source no longer exists (workspace switch or refetch)
  // so a stale chip can't hide every skill with no visible way to clear it.
  const prevAvailableRef = useRef(availableSources);
  if (prevAvailableRef.current !== availableSources) {
    prevAvailableRef.current = availableSources;
    setActiveSources((prev) => {
      const next = new Set([...prev].filter((source) => availableSources.includes(source)));
      return next.size === prev.size ? prev : next;
    });
  }

  const filteredItems = useMemo(() => {
    const bySource =
      activeSources.size === 0
        ? items
        : items.filter((skill) => skill.sources.some((source) => activeSources.has(source)));
    // Reuse the app-wide fuzzy search so skills match the same way as the command menu
    // and mention suggestions; limit stays at the full set since this isn't a dropdown.
    return fuzzySearch(searchQuery, bySource, {
      keys: ['name', 'description'],
      limit: bySource.length,
    });
  }, [items, searchQuery, activeSources]);

  const toggleSource = useCallback((source: string) => {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    activeSources,
    toggleSource,
    availableSources,
    filteredItems,
  };
}
