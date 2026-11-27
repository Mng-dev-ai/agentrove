import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { FieldMessage } from '@/components/ui/primitives/FieldMessage/FieldMessage';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeDropdown } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { PersonaDropdown } from '@/components/chat/persona-selector/PersonaSelector';
import { PermissionModeDropdown } from '@/components/chat/permission-mode-selector/PermissionModeSelector';
import { useDropdown } from '@/hooks/useDropdown';
import { usePanelFit } from '@/hooks/usePanelFit';
import type { Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import {
  MEMBER_NAME_MAX_LENGTH,
  resolveMember,
  type MemberDraft,
  type MemberName,
} from './memberDraft';
import styles from './MemberPopover.module.scss';

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
