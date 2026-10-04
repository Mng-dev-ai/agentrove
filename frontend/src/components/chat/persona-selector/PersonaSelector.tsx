import { memo, useMemo } from 'react';
import { UserCircle } from 'lucide-react';
import { Dropdown, type DropdownPosition } from '@/components/ui/primitives/Dropdown/Dropdown';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_PERSONA,
} from '@/store/chatSettingsStore';
import { useIsSplitMode } from '@/hooks/useIsSplitMode';
import { useChatContext } from '@/hooks/useChatContext';
import type { Persona } from '@/types/user.types';

interface PersonaOption {
  value: string;
  label: string;
}

const DEFAULT_OPTION: PersonaOption = { value: DEFAULT_PERSONA, label: 'Default' };

interface PersonaDropdownControlProps {
  dropdownPosition?: DropdownPosition;
  disabled?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
}

export interface PersonaDropdownProps extends PersonaDropdownControlProps {
  personas: Persona[];
  value: string;
  onChange: (persona: string) => void;
}

export const PersonaDropdown = memo(function PersonaDropdown({
  personas,
  value,
  onChange,
  dropdownPosition = 'bottom',
  dropdownAlign,
  disabled = false,
  variant = 'default',
}: PersonaDropdownProps) {
  const isSplitMode = useIsSplitMode();

  const items = useMemo(
    () => [DEFAULT_OPTION, ...personas.map((p) => ({ value: p.name, label: p.name }))],
    [personas],
  );

  if (personas.length === 0) return null;

  const selectedItem = items.find((item) => item.value === value) ?? DEFAULT_OPTION;

  return (
    <Dropdown
      value={selectedItem}
      items={items}
      getItemKey={(item) => item.value}
      getItemLabel={(item) => item.label}
      onSelect={(item) => onChange(item.value)}
      leftIcon={UserCircle}
      width="10rem"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile
      forceCompact={isSplitMode}
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
    />
  );
});

export interface PersonaSelectorProps extends PersonaDropdownControlProps {
  chatId?: string;
}

export const PersonaSelector = memo(function PersonaSelector({
  chatId,
  ...controlProps
}: PersonaSelectorProps) {
  const { personas } = useChatContext();
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const selectedPersona = useChatSettingsStore(
    (state) => state.personaByChat[key] ?? DEFAULT_PERSONA,
  );

  return (
    <PersonaDropdown
      personas={personas}
      value={selectedPersona}
      onChange={(persona) => useChatSettingsStore.getState().setPersona(key, persona)}
      {...controlProps}
    />
  );
});
