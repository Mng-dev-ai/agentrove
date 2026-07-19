import { memo, type ComponentType, type SVGProps } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useDropdown } from '@/hooks/useDropdown';
import styles from './ToggleDropdown.module.scss';

export interface ToggleDropdownOption {
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

interface ToggleDropdownProps {
  // Indexed by the toggle value: [off, on].
  options: readonly [ToggleDropdownOption, ToggleDropdownOption];
  value: boolean;
  onSelect: (value: boolean) => void;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  // CSS length for the panel (e.g. '8rem'), not a class name
  width: string;
  disabled?: boolean;
}

export const ToggleDropdown = memo(function ToggleDropdown({
  options,
  value,
  onSelect,
  icon,
  width,
  disabled = false,
}: ToggleDropdownProps) {
  // Hand-styled for the landing composer (not Dropdown) to match the workspace selector.
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const selected = options[value ? 1 : 0];
  const TriggerIcon = selected.icon ?? icon;

  return (
    <div className={styles['toggle-dropdown']} ref={dropdownRef}>
      <Button
        variant="unstyled"
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={styles.trigger}
      >
        {TriggerIcon && <TriggerIcon className={styles['trigger-icon']} />}
        <span className={styles['trigger-label']}>{selected.label}</span>
        <ChevronDown className={styles.chevron} />
      </Button>

      {isOpen && (
        <div className={styles.panel} style={{ width }}>
          {options.map((opt, index) => {
            const optValue = index === 1;
            const isSelected = value === optValue;
            return (
              <Button
                variant="unstyled"
                key={opt.label}
                type="button"
                onClick={() => {
                  onSelect(optValue);
                  setIsOpen(false);
                }}
                className={clsx(styles.option, isSelected && styles['option--selected'])}
              >
                <Check
                  className={clsx(
                    styles['option-check'],
                    isSelected && styles['option-check--selected'],
                  )}
                />
                <span>{opt.label}</span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
});
