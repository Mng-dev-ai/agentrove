import { memo, type ComponentType, type SVGProps } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { useDropdown } from '@/hooks/useDropdown';

export interface ToggleDropdownOption {
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

interface ToggleDropdownProps {
  // Indexed by the toggle value: [off, on].
  options: readonly [ToggleDropdownOption, ToggleDropdownOption];
  value: boolean;
  onSelect: (value: boolean) => void;
  // Fixed trigger icon; a per-option icon takes precedence when provided.
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
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
  // Compact two-option dropdown for the landing composer toolbar. Hand-styled to
  // match the adjacent workspace selector trigger, not the Dropdown primitive.
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const selected = options[value ? 1 : 0];
  const TriggerIcon = selected.icon ?? icon;

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="unstyled"
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
      >
        {TriggerIcon && (
          <TriggerIcon className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        )}
        <span>{selected.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
      </Button>

      {isOpen && (
        <div
          className={`absolute left-0 top-full z-[60] mt-1 ${width} rounded-xl border border-border bg-surface-secondary/95 py-1 shadow-medium backdrop-blur-xl backdrop-saturate-150 dark:border-border-dark dark:bg-surface-dark-secondary/95 dark:shadow-black/40`}
        >
          {options.map((opt, index) => {
            const optValue = index === 1;
            return (
              <Button
                variant="unstyled"
                key={opt.label}
                type="button"
                onClick={() => {
                  onSelect(optValue);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-2xs transition-colors duration-150 ${
                  value === optValue
                    ? 'bg-surface-hover/80 text-text-primary dark:bg-surface-dark-hover/80 dark:text-text-dark-primary'
                    : 'text-text-secondary hover:bg-surface-hover/50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover/50'
                }`}
              >
                <Check
                  className={`h-3 w-3 shrink-0 ${value === optValue ? 'opacity-100' : 'opacity-0'}`}
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
