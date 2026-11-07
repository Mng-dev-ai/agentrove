import { memo } from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { MachineStatusDot } from '@/components/machines/MachineStatusDot';
import { MACHINE_STATUS_LABEL } from '@/components/machines/machineStatusLabel';
import { useDropdown } from '@/hooks/useDropdown';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import { LOCAL_MACHINE_NAME, useMachineStore, useTargetMachineId } from '@/store/machineStore';
import { LOCAL_MACHINE_ID, type MachineStatus } from '@/types/machine.types';
import toggleStyles from '@/components/ui/shared/ToggleDropdown/ToggleDropdown.module.scss';
import styles from './RunLocationSelector.module.scss';

interface RunLocationSelectorProps {
  disabled?: boolean;
}

interface MachineOption {
  id: string;
  name: string;
  status: MachineStatus;
}

export const RunLocationSelector = memo(function RunLocationSelector({
  disabled = false,
}: RunLocationSelectorProps) {
  const navigate = useNavigate();
  const machines = useMachineStore((state) => state.machines);
  const connections = useMachineStore((state) => state.connections);
  const targetMachineId = useTargetMachineId();
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();

  const options: MachineOption[] = [
    { id: LOCAL_MACHINE_ID, name: LOCAL_MACHINE_NAME, status: 'online' },
    ...machines.map((machine) => ({
      id: machine.id,
      name: machine.name,
      status: connections[machine.id]?.status ?? 'checking',
    })),
  ];
  const selected = options.find((option) => option.id === targetMachineId) ?? options[0];

  return (
    <div className={toggleStyles['toggle-dropdown']} ref={dropdownRef}>
      <Button
        variant="unstyled"
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={toggleStyles.trigger}
        aria-label="Run on machine"
        aria-expanded={isOpen}
      >
        {selected.status !== 'online' && <MachineStatusDot status={selected.status} />}
        <span className={toggleStyles['trigger-label']}>{selected.name}</span>
        <ChevronDown className={toggleStyles.chevron} />
      </Button>

      {isOpen && (
        <div className={clsx(toggleStyles.panel, styles.panel)} role="listbox">
          {options.map((option) => {
            const isSelected = option.id === selected.id;
            const isOnline = option.status === 'online';
            return (
              <Button
                variant="unstyled"
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={!isOnline}
                onClick={() => {
                  useChatSettingsStore.getState().setTargetMachine(option.id);
                  setIsOpen(false);
                }}
                className={clsx(
                  toggleStyles.option,
                  styles.option,
                  isSelected && toggleStyles['option--selected'],
                )}
              >
                <Check
                  className={clsx(
                    toggleStyles['option-check'],
                    isSelected && toggleStyles['option-check--selected'],
                  )}
                />
                {!isOnline && <MachineStatusDot status={option.status} />}
                <span className={styles.name}>{option.name}</span>
                {!isOnline && (
                  <span className={styles.status}>{MACHINE_STATUS_LABEL[option.status]}</span>
                )}
              </Button>
            );
          })}
          <div className={styles.divider} />
          <Button
            variant="unstyled"
            type="button"
            onClick={() => {
              setIsOpen(false);
              navigate('/settings', { state: { tab: 'machines' } });
            }}
            className={clsx(toggleStyles.option, styles.option)}
          >
            <Plus className={styles['add-icon']} />
            <span className={styles.name}>Add machine…</span>
          </Button>
        </div>
      )}
    </div>
  );
});
