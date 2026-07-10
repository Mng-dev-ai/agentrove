import { useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, Folder, ShieldAlert } from 'lucide-react';
import { LazyMarkDown } from '@/components/ui/markdown/LazyMarkDown';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { PermissionRequest } from '@/types/chat.types';
import { PermissionApprovalButtons } from '@/components/ui/shared/ApprovalFooter/ApprovalFooter';
import { filterOptions } from '@/utils/permissionStorage';
import { formatResult } from '@/utils/format';
import styles from './ToolPermissionInline.module.scss';

const HEADLINE_KEYS = new Set(['reason', 'description']);
const COMMAND_KEYS = new Set(['command', 'cmd']);
const CWD_KEYS = new Set(['cwd', 'working_directory']);
const SHELL_WRAPPER_FLAGS = new Set(['-lc', '-lic', '-c']);
// Conservative "safe" charset — anything outside it (whitespace, shell
// metacharacters like ; | & > < $ ` * ? ( ) ~ \, embedded quotes, etc.) gets
// POSIX single-quoted so the rendered command is lossless and can't parse
// as a different shell invocation than the tool will actually execute.
const SHELL_SAFE_ARG_RE = /^[-A-Za-z0-9_./=:@%+,]+$/;
// Match only POSIX shell executables (bare or absolute path). Prevents the
// wrapper unwrap from misrepresenting non-shell invocations like
// `python -c 'print(1)'` — those must render in full so the user approves
// the real interpreter, not just the script body.
const SHELL_BASENAME_RE = /(?:^|\/)(sh|bash|zsh|dash|ksh|fish)$/;
// Diagnostic identifiers (call_id, turn_id, request_id, …) get collapsed
// behind "Show details"; everything else — including provider scope metadata
// like proposed_execpolicy_amendment — stays visible so the user can see the
// full breadth of what they're approving.
const DIAGNOSTIC_KEY_RE = /(?:^|_)id$/;

interface ExtractedFields {
  headline: string | null;
  command: string | null;
  cwd: string | null;
  meta: Array<[string, unknown]>;
  diagnostics: Array<[string, unknown]>;
}

function extractFields(input: Record<string, unknown>): ExtractedFields {
  let headline: string | null = null;
  let command: string | null = null;
  let cwd: string | null = null;
  const meta: Array<[string, unknown]> = [];
  const diagnostics: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(input)) {
    const lower = key.toLowerCase();
    if (headline === null && HEADLINE_KEYS.has(lower) && typeof value === 'string') {
      headline = value;
      continue;
    }
    if (command === null && COMMAND_KEYS.has(lower)) {
      const formatted = formatShellCommand(value);
      if (formatted !== null) {
        command = formatted;
        continue;
      }
    }
    if (cwd === null && CWD_KEYS.has(lower) && typeof value === 'string') {
      cwd = value;
      continue;
    }
    if (DIAGNOSTIC_KEY_RE.test(lower)) {
      diagnostics.push([key, value]);
    } else {
      meta.push([key, value]);
    }
  }

  return { headline, command, cwd, meta, diagnostics };
}

function formatShellCommand(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length === 0) return null;
  const arr = value.map(String);
  // Only unwrap when arr[0] is an actual shell — otherwise we'd hide the real
  // interpreter (python, node, rsync, …) behind a `-c`/`-lc`/`-lic` flag that
  // those tools also accept but with different semantics.
  if (arr.length === 3 && SHELL_WRAPPER_FLAGS.has(arr[1]) && SHELL_BASENAME_RE.test(arr[0])) {
    return arr[2];
  }
  return arr.map(shellQuote).join(' ');
}

function shellQuote(arg: string): string {
  if (arg === '') return "''";
  if (SHELL_SAFE_ARG_RE.test(arg)) return arg;
  // POSIX: close the single-quoted span, emit an escaped literal quote, reopen.
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

interface DetailsListProps {
  details: Array<[string, unknown]>;
}

function DetailsList({ details }: DetailsListProps) {
  return (
    <div className={styles.list}>
      {details.map(([key, value]) => (
        <div key={key} className={styles['list-item']}>
          <div className={styles['list-label']}>{key}</div>
          <div className={styles['list-value']}>
            <LazyMarkDown content={formatResult(value)} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ToolPermissionInlineProps {
  request: PermissionRequest | null;
  onApprove: (optionId: string) => void;
  onReject: (optionId: string) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ToolPermissionInline({
  request,
  onApprove,
  onReject,
  isLoading = false,
  error = null,
}: ToolPermissionInlineProps) {
  const [showDetails, setShowDetails] = useState(false);
  const prevRequestIdRef = useRef<string | null>(null);

  // Reset the disclosure when a new permission request arrives — the
  // component stays mounted across requests in the chat UI, so without this
  // an expanded section from a prior request would leak into the next one.
  const currentRequestId = request?.request_id ?? null;
  if (prevRequestIdRef.current !== currentRequestId) {
    prevRequestIdRef.current = currentRequestId;
    if (showDetails) setShowDetails(false);
  }

  if (!request || request.tool_name === 'ExitPlanMode') return null;

  const fields = extractFields(request.tool_input ?? {});

  const allowOptions = filterOptions(request.options, 'allow');
  const rejectOptions = filterOptions(request.options, 'reject');
  const hasStructured = fields.headline !== null || fields.command !== null;
  const hasAnyContent =
    hasStructured || fields.cwd !== null || fields.meta.length > 0 || fields.diagnostics.length > 0;
  const needsMetaTopMargin = hasStructured || fields.cwd !== null;

  return (
    <div className={styles.permission}>
      <div className={styles.header}>
        <div className={styles['header-icon']}>
          <ShieldAlert className={styles.shield} />
        </div>
        <span className={styles['header-title']}>Permission required</span>
        <code className={styles['tool-name']}>{request.tool_name}</code>
      </div>

      <div className={styles.body}>
        {fields.headline && <div className={styles.headline}>{fields.headline}</div>}
        {fields.command && (
          <div className={styles.command}>
            <code className={styles['command-code']}>
              <span className={styles['command-prompt']}>$</span>
              {fields.command}
            </code>
          </div>
        )}
        {fields.cwd && (
          <div className={styles.cwd}>
            <Folder className={styles['cwd-icon']} />
            <span className={styles['cwd-path']}>{fields.cwd}</span>
          </div>
        )}
        {fields.meta.length > 0 && (
          <div className={clsx(needsMetaTopMargin && styles['meta-spaced'])}>
            <DetailsList details={fields.meta} />
          </div>
        )}
        {fields.diagnostics.length > 0 && (
          <>
            <Button
              variant="unstyled"
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className={styles['details-toggle']}
            >
              <ChevronRight
                className={clsx(styles.chevron, showDetails && styles['chevron--open'])}
              />
              {showDetails ? 'Hide details' : 'Show details'}
            </Button>
            {showDetails && (
              <div className={styles['details-panel']}>
                <DetailsList details={fields.diagnostics} />
              </div>
            )}
          </>
        )}
        {!hasAnyContent && <p className={styles.empty}>No parameters</p>}
      </div>

      <PermissionApprovalButtons
        allowOptions={allowOptions}
        rejectOptions={rejectOptions}
        onApprove={onApprove}
        onReject={onReject}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}
