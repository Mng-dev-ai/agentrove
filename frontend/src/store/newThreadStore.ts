import { create } from 'zustand';
import type { GroupMember } from '@/components/channels/memberDraft';

interface NewThreadMembers {
  // The machine whose models the members name
  machineId: string;
  list: GroupMember[];
}

export interface NewThreadPreselect {
  workspaceId: string;
  machineId: string;
}

// The New thread modal and its draft, which outlives closing the modal within the session.
// Attachments stay in chatStore under PENDING_NEW_CHAT_KEY.
interface NewThreadState {
  isOpen: boolean;
  preselect: NewThreadPreselect | null;
  message: string;
  // null follows the target machine's default model as the only member
  members: NewThreadMembers | null;
  open: (preselect?: NewThreadPreselect) => void;
  close: () => void;
  setMessage: (message: string) => void;
  setMembers: (members: NewThreadMembers) => void;
  clearDraft: () => void;
}

export const useNewThreadStore = create<NewThreadState>((set) => ({
  isOpen: false,
  preselect: null,
  message: '',
  members: null,
  open: (preselect) => set({ isOpen: true, preselect: preselect ?? null }),
  close: () => set({ isOpen: false, preselect: null }),
  setMessage: (message) => set({ message }),
  setMembers: (members) => set({ members }),
  clearDraft: () => set({ message: '', members: null }),
}));
