import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AlertCircle, MessageCircleQuestion, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Switch } from '@/components/ui/primitives/Switch/Switch';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import {
  buildElicitationContent,
  parseElicitationSchema,
  type ElicitationField,
  type ElicitationValues,
} from '@/utils/elicitationSchema';
import type { ElicitationContent, ElicitationRequest } from '@/types/chat.types';
import styles from './ElicitationInline.module.scss';

function toggleSelection(
  current: string | string[] | boolean | undefined,
  value: string,
): string[] {
  const list = Array.isArray(current) ? current : [];
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

interface FieldRowProps {
  field: ElicitationField;
  fieldId: string;
  value: string | string[] | boolean | undefined;
  onChange: (value: string | string[] | boolean) => void;
  disabled: boolean;
}

function FieldRow({ field, fieldId, value, onChange, disabled }: FieldRowProps) {
  return (
    <div className={field.isCustomAnswer ? styles['field--custom'] : styles.field}>
      {field.kind === 'boolean' ? (
        <div className={styles['toggle-row']}>
          <Switch
            id={fieldId}
            checked={value === true}
            onCheckedChange={onChange}
            disabled={disabled}
            size="sm"
          />
          <Label htmlFor={fieldId}>{field.label}</Label>
        </div>
      ) : field.kind === 'text' || field.kind === 'number' ? (
        <Label htmlFor={fieldId}>{field.label}</Label>
      ) : (
        <div className={styles['field-label']}>{field.label}</div>
      )}
      {field.description && <div className={styles['field-description']}>{field.description}</div>}

      {(field.kind === 'select' || field.kind === 'multiselect') && (
        <div className={styles.options}>
          {field.options.map((option) => {
            const checked =
              field.kind === 'select'
                ? value === option.value
                : Array.isArray(value) && value.includes(option.value);
            return (
              <label key={option.value} className={styles.option}>
                <input
                  type={field.kind === 'select' ? 'radio' : 'checkbox'}
                  name={fieldId}
                  className={styles['option-control']}
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      field.kind === 'select' ? option.value : toggleSelection(value, option.value),
                    )
                  }
                />
                <span className={styles['option-content']}>
                  <span className={styles['option-title']}>{option.title}</span>
                  {option.description && (
                    <span className={styles['option-description']}>{option.description}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {field.kind === 'text' && (
        <Input
          id={fieldId}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {field.kind === 'number' && (
        <Input
          id={fieldId}
          type="number"
          step={field.integer ? 1 : 'any'}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

interface ElicitationInlineProps {
  request: ElicitationRequest | null;
  onSubmit: (content: ElicitationContent) => void;
  onSkip: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ElicitationInline({
  request,
  onSubmit,
  onSkip,
  onCancel,
  isLoading = false,
  error = null,
}: ElicitationInlineProps) {
  const [values, setValues] = useState<ElicitationValues>({});
  const prevRequestIdRef = useRef<string | null>(null);

  // The component stays mounted across requests in the chat UI — without this
  // reset, answers typed into a prior form would leak into the next one.
  const currentRequestId = request?.request_id ?? null;
  if (prevRequestIdRef.current !== currentRequestId) {
    prevRequestIdRef.current = currentRequestId;
    if (Object.keys(values).length > 0) setValues({});
  }

  const fields = useMemo(() => parseElicitationSchema(request?.requested_schema), [request]);

  if (!request) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isLoading) return;
    onSubmit(buildElicitationContent(fields, values));
  };

  // Escape means "continue without answering", never "abort the tool call".
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape' || isLoading) return;
    event.preventDefault();
    onSkip();
  };

  return (
    <form className={styles.elicitation} onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <div className={styles.header}>
        <div className={styles['header-icon']}>
          <MessageCircleQuestion className={styles['header-glyph']} />
        </div>
        <span className={styles['header-title']}>Agent question</span>
        <FloatingTooltip content="Cancel this tool call" className={styles['dismiss-wrap']}>
          <Button
            variant="unstyled"
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Cancel this tool call"
            className={styles.dismiss}
          >
            <X className={styles['dismiss-icon']} />
          </Button>
        </FloatingTooltip>
      </div>

      <div className={styles.body}>
        {request.message && <div className={styles.message}>{request.message}</div>}
        {fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            fieldId={`${request.request_id}-${field.key}`}
            value={values[field.key]}
            onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
            disabled={isLoading}
          />
        ))}
      </div>

      <div className={styles.footer}>
        {error && (
          <div className={styles.error}>
            <AlertCircle className={styles['error-icon']} />
            <span>{error}</span>
          </div>
        )}
        <div className={styles.actions}>
          <Button type="button" variant="ghost" size="sm" onClick={onSkip} disabled={isLoading}>
            Skip
          </Button>
          <Button type="submit" variant="primary" size="sm" isLoading={isLoading}>
            Submit
          </Button>
        </div>
      </div>
    </form>
  );
}
