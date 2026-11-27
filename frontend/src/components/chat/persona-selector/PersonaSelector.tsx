import { memo, useMemo } from 'react';
import { useChatSettings } from '@/hooks/useChatSettings';
import { UserCircle } from 'lucide-react';
import { Dropdown, type DropdownPosition } from '@/components/ui/primitives/Dropdown/Dropdown';
import { useChatSettingsStore, DEFAULT_CHAT_SETTINGS_KEY } from '@/store/chatSettingsStore';
import { useChatContext } from '@/hooks/useChatContext';
import type { Persona } from '@/types/user.types';
import { getPersonaOption, getPersonaOptions } from './personaOptions';

interface PersonaDropdownControlProps {
  dropdownPosition?: DropdownPosition;
  disabled?: boolean;
  compact?: boolean;
  variant?: 'default' | 'text';
  dropdownAlign?: 'left' | 'right';
  onInlineSelect?: () => void;
  mixed?: boolean;
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
  compact = true,
  variant = 'default',
  onInlineSelect,
  mixed = false,
}: PersonaDropdownProps) {
  const items = useMemo(() => getPersonaOptions(personas), [personas]);

  if (personas.length === 0) return null;

  const selectedItem = getPersonaOption(value, items);

  return (
    <Dropdown
      value={selectedItem}
      items={items}
      getItemKey={(item) => item.value}
      getItemLabel={(item) => item.label}
      getItemShortLabel={mixed ? () => 'Mixed' : undefined}
      onSelect={(item) => onChange(item.value)}
      leftIcon={UserCircle}
      ariaLabel="Persona"
      width="10rem"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compact={compact}
      triggerVariant={variant}
      dropdownAlign={dropdownAlign}
      onInlineSelect={onInlineSelect}
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
  const { persona } = useChatSettings(chatId);

  return (
    <PersonaDropdown
      personas={personas}
      value={persona}
      onChange={(persona) => useChatSettingsStore.getState().setPersona(key, persona)}
      {...controlProps}
    />
  );
});
