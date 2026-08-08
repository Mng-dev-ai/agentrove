import { useMemo } from 'react';
import { usePermissionStore } from '@/store/permissionStore';
import { useElicitationStore } from '@/store/elicitationStore';

// Chats blocked on the user — the union of both request channels:
// - permissionStore: tool permissions, plan approvals, Grok's ask_user_question
//   (mapped to permission_request by the backend).
// - elicitationStore: agent question forms (Claude/Codex AskUserQuestion arrives
//   as an ACP form elicitation) and MCP-server elicitations.
// Both stores drop empty queues, so every remaining key has an outstanding request.
export function useBlockedChatIds(): Set<string> {
  const pendingPermissions = usePermissionStore((state) => state.pendingRequests);
  const pendingElicitations = useElicitationStore((state) => state.pendingRequests);
  return useMemo(
    () => new Set([...pendingPermissions.keys(), ...pendingElicitations.keys()]),
    [pendingPermissions, pendingElicitations],
  );
}
