import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeDropdown } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { PersonaDropdown } from '@/components/chat/persona-selector/PersonaSelector';
import { PermissionModeDropdown } from '@/components/chat/permission-mode-selector/PermissionModeSelector';
import { useDropdown } from '@/hooks/useDropdown';
import { usePanelFit } from '@/hooks/usePanelFit';
import { stateClasses } from '@/config/stateClasses';
import type { Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import {
  MEMBER_NAME_MAX_LENGTH,
  newMemberDraft,
  resolveMember,
  type MemberDraft,
  type MemberName,
} from './memberDraft';
import styles from './MemberChips.module.scss';

interface MemberPopoverProps {
  machineId: string;
  member: MemberDraft;
  memberName: MemberName;
  models: Model[];
  personas: Persona[];
  onChange: (patch: Partial<MemberDraft>) => void;
  onRemove?: () => void;
  trigger: (isOpen: boolean, toggle: () => void) => ReactNode;
  footer?: (close: () => void) => ReactNode;
  fill?: boolean;
}

export function MemberPopover({
  machineId,
  member,
  memberName,
  models,
  personas,
  onChange,
  onRemove,
  trigger,
  footer,
  fill = false,
}: MemberPopoverProps) {
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const popoverRef = useRef<HTMLDivElement>(null);
  const fit = usePanelFit(dropdownRef, popoverRef, isOpen);
  const { modelId, model, agentKind, hasThinking, supportsPersona } = resolveMember(member, models);
  const nameInputId = `member-name-${member.key}`;

  return (
    <div ref={dropdownRef} className={styles['chip-wrap']}>
      {trigger(isOpen, () => setIsOpen(!isOpen))}

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${memberName.name} settings`}
          style={{ maxHeight: fit?.maxHeight }}
          className={clsx(
            styles.popover,
            fit?.side === 'top' && styles['popover--top'],
            fit?.maxHeight !== undefined && styles['popover--capped'],
            fill && styles['popover--fill'],
          )}
        >
          <div className={styles['popover-field']}>
            <Label htmlFor={nameInputId} className={styles['popover-label']}>
              Name
            </Label>
            <Input
              id={nameInputId}
              value={member.customName ?? memberName.name}
              onChange={(e) => onChange({ customName: e.target.value })}
              placeholder={memberName.name}
              maxLength={MEMBER_NAME_MAX_LENGTH}
              hasError={!!memberName.error}
              className={styles['popover-input']}
            />
            <FieldMessage variant="error" className={styles['popover-error']}>
              {memberName.error}
            </FieldMessage>
          </div>
          <div className={styles['popover-row']}>
            <span className={styles['popover-label']}>Model</span>
            <ModelSelector
              selectedModelId={modelId}
              onModelChange={(next) => onChange({ modelId: next })}
              dropdownPosition="auto"
              dropdownAlign="right"
              variant="text"
              compact={false}
              machineId={machineId}
            />
          </div>
          {hasThinking && (
            <div className={styles['popover-row']}>
              <span className={styles['popover-label']}>Thinking</span>
              <ThinkingModeDropdown
                value={member.thinkingMode}
                onChange={(thinkingMode) => onChange({ thinkingMode })}
                agentKind={agentKind}
                model={model}
                dropdownPosition="auto"
                dropdownAlign="right"
                variant="text"
                compact={false}
              />
            </div>
          )}
          {supportsPersona && personas.length > 0 && (
            <div className={styles['popover-row']}>
              <span className={styles['popover-label']}>Persona</span>
              <PersonaDropdown
                personas={personas}
                value={member.persona}
                onChange={(persona) => onChange({ persona })}
                dropdownPosition="auto"
                dropdownAlign="right"
                variant="text"
                compact={false}
              />
            </div>
          )}
          <div className={styles['popover-row']}>
            <span className={styles['popover-label']}>Permission</span>
            <PermissionModeDropdown
              value={member.permissionMode}
              onChange={(permissionMode) => onChange({ permissionMode })}
              agentKind={agentKind}
              dropdownPosition="auto"
              dropdownAlign="right"
              variant="text"
              compact={false}
            />
          </div>
          {onRemove && (
            <>
              <div role="separator" className={styles['popover-divider']} />
              <Button
                type="button"
                variant="unstyled"
                onClick={() => {
                  setIsOpen(false);
                  onRemove();
                }}
                className={styles['popover-remove']}
              >
                <Trash2 className={styles['popover-remove-icon']} />
                Remove member
              </Button>
            </>
          )}
          {footer?.(() => setIsOpen(false))}
        </div>
      )}
    </div>
  );
}

interface MemberChipProps {
  machineId: string;
  member: MemberDraft;
  memberName: MemberName;
  models: Model[];
  personas: Persona[];
  canRemove: boolean;
  onChange: (patch: Partial<MemberDraft>) => void;
  onRemove: () => void;
}

function MemberChip({ canRemove, onRemove, ...props }: MemberChipProps) {
  const { modelName, agentKind } = resolveMember(props.member, props.models);
  return (
    <MemberPopover
      {...props}
      onRemove={canRemove ? onRemove : undefined}
      trigger={(isOpen, toggle) => (
        <FloatingTooltip content={isOpen ? '' : modelName}>
          <Button
            type="button"
            variant="unstyled"
            onClick={toggle}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            className={clsx(
              styles.chip,
              props.memberName.error && styles['chip--error'],
              isOpen && stateClasses.OPEN,
            )}
          >
            <ProviderIcon agentKind={agentKind} className={styles['chip-icon']} />
            <span className={styles['chip-label']}>{props.memberName.name}</span>
            <ChevronDown className={styles['chip-caret']} />
          </Button>
        </FloatingTooltip>
      )}
    />
  );
}

interface MemberChipsProps {
  machineId: string;
  members: MemberDraft[];
  memberNames: MemberName[];
  models: Model[];
  personas: Persona[];
  onChange: (members: MemberDraft[]) => void;
}

export function MemberChips({
  machineId,
  members,
  memberNames,
  models,
  personas,
  onChange,
}: MemberChipsProps) {
  return (
    <div className={styles.members}>
      {members.map((member, index) => (
        <MemberChip
          key={member.key}
          machineId={machineId}
          member={member}
          memberName={memberNames[index]}
          models={models}
          personas={personas}
          canRemove={members.length > 1}
          onChange={(patch) =>
            onChange(members.map((m) => (m.key === member.key ? { ...m, ...patch } : m)))
          }
          onRemove={() => onChange(members.filter((m) => m.key !== member.key))}
        />
      ))}
      <Button
        type="button"
        variant="unstyled"
        onClick={() => onChange([...members, newMemberDraft()])}
        className={styles['add-chip']}
        aria-label="Add member"
      >
        <Plus className={styles['add-icon']} />
      </Button>
    </div>
  );
}
