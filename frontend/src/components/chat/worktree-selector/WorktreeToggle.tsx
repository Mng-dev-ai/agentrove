import { memo } from 'react';
import { GitFork } from 'lucide-react';
import { ToggleDropdown, type ToggleDropdownOption } from '@/components/ui/shared/ToggleDropdown';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_WORKTREE,
} from '@/store/chatSettingsStore';

const OPTIONS: readonly [ToggleDropdownOption, ToggleDropdownOption] = [
  { label: 'No worktree' },
  { label: 'Worktree' },
];

interface WorktreeToggleProps {
  disabled?: boolean;
}

export const WorktreeToggle = memo(function WorktreeToggle({
  disabled = false,
}: WorktreeToggleProps) {
  // Creation-time control: run the chat in an isolated git worktree. Applies to
  // both local and cloud runs.
  const worktree = useChatSettingsStore(
    (state) => state.worktreeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_WORKTREE,
  );

  return (
    <ToggleDropdown
      options={OPTIONS}
      value={worktree}
      onSelect={(enabled) =>
        useChatSettingsStore.getState().setWorktree(DEFAULT_CHAT_SETTINGS_KEY, enabled)
      }
      icon={GitFork}
      width="w-36"
      disabled={disabled}
    />
  );
});
