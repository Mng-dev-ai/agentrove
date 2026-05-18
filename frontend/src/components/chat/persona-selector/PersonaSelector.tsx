import { memo, useMemo } from 'react';
import { UserCircle } from 'lucide-react';
import { Dropdown } from '@/components/ui/primitives/Dropdown';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_PERSONA,
} from '@/store/chatSettingsStore';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import { useChatContext } from '@/hooks/useChatContext';

interface PersonaOption {
  value: string;
  label: string;
}

const DEFAULT_OPTION: PersonaOption = { value: DEFAULT_PERSONA, label: 'Default' };

export interface PersonaSelectorProps {
  chatId?: string;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export const PersonaSelector = memo(function PersonaSelector({
  chatId,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  variant = 'default',
}: PersonaSelectorProps) {
  const { personas } = useChatContext();
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const selectedPersona = useChatSettingsStore(
    (state) => state.personaByChat[key] ?? DEFAULT_PERSONA,
  );
  const isSplitMode = useIsSplitMode();

  const items = useMemo(
    () => [DEFAULT_OPTION, ...personas.map((p) => ({ value: p.name, label: p.name }))],
    [personas],
  );

  if (personas.length === 0) return null;

  const selectedItem = items.find((item) => item.value === selectedPersona) ?? DEFAULT_OPTION;

  return (
    <Dropdown
      value={selectedItem}
      items={items}
      getItemKey={(item) => item.value}
      getItemLabel={(item) => item.label}
      onSelect={(item) => useChatSettingsStore.getState().setPersona(key, item.value)}
      leftIcon={UserCircle}
      width="w-40"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile
      forceCompact={isSplitMode}
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
    />
  );
});
