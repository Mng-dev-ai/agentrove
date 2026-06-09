import { memo } from 'react';
import { Cloud, Monitor } from 'lucide-react';
import { ToggleDropdown, type ToggleDropdownOption } from '@/components/ui/shared/ToggleDropdown';
import { useChatSettingsStore } from '@/store/chatSettingsStore';

const OPTIONS: readonly [ToggleDropdownOption, ToggleDropdownOption] = [
  { label: 'Local', icon: Monitor },
  { label: 'Cloud', icon: Cloud },
];

interface RunLocationSelectorProps {
  disabled?: boolean;
}

export const RunLocationSelector = memo(function RunLocationSelector({
  disabled = false,
}: RunLocationSelectorProps) {
  // Creation-time control: run a new chat locally or on the configured cloud
  // instance. Orthogonal to worktree.
  const runOnCloud = useChatSettingsStore((state) => state.runOnCloud);

  return (
    <ToggleDropdown
      options={OPTIONS}
      value={runOnCloud}
      onSelect={(enabled) => useChatSettingsStore.getState().setRunOnCloud(enabled)}
      width="w-32"
      disabled={disabled}
    />
  );
});
