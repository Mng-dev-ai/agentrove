import { useRef, useState } from 'react';
import { ChevronRight, Folder, ShieldAlert } from 'lucide-react';
import { LazyMarkDown } from '@/components/ui/markdown/LazyMarkDown';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { PermissionRequest } from '@/types/chat.types';
import { PermissionApprovalButtons } from '@/components/ui/shared/ApprovalFooter/ApprovalFooter';
import { filterOptions } from '@/utils/permissionStorage';
import { cn } from '@/utils/cn';
import { formatResult } from '@/utils/format';

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
    <div className="space-y-2">
      {details.map(([key, value]) => (
        <div key={key} className="space-y-0.5">
          <div className="text-2xs font-medium uppercase tracking-wider text-text-tertiary dark:text-text-dark-tertiary">
            {key}
          </div>
          <div className="overflow-auto rounded-md bg-black/5 px-2 py-1.5 text-xs text-text-primary dark:bg-white/5 dark:text-text-dark-primary">
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
    <div className="overflow-hidden rounded-lg border border-border/50 bg-surface-tertiary dark:border-border-dark/50 dark:bg-surface-dark-tertiary">
      <div className="flex h-9 items-center gap-2 border-b border-border/50 px-3 dark:border-border-dark/50">
        <div className="rounded-md bg-black/5 p-1 dark:bg-white/5">
          <ShieldAlert className="h-3.5 w-3.5 text-text-tertiary dark:text-text-dark-tertiary" />
        </div>
        <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
          Permission required
        </span>
        <code className="ml-auto rounded bg-black/5 px-1.5 py-0.5 font-mono text-2xs text-text-secondary dark:bg-white/5 dark:text-text-dark-secondary">
          {request.tool_name}
        </code>
      </div>

      <div className="max-h-[50vh] overflow-y-auto p-3">
        {fields.headline && (
          <div className="mb-3 text-xs leading-relaxed text-text-primary dark:text-text-dark-primary">
            {fields.headline}
          </div>
        )}
        {fields.command && (
          <div className="overflow-x-auto rounded-md bg-black/5 px-2.5 py-2 dark:bg-white/5">
            <code className="whitespace-pre font-mono text-xs text-text-primary dark:text-text-dark-primary">
              <span className="mr-2 select-none text-text-quaternary dark:text-text-dark-quaternary">
                $
              </span>
              {fields.command}
            </code>
          </div>
        )}
        {fields.cwd && (
          <div className="mt-2 flex items-center gap-1.5 font-mono text-2xs text-text-tertiary dark:text-text-dark-tertiary">
            <Folder className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{fields.cwd}</span>
          </div>
        )}
        {fields.meta.length > 0 && (
          <div className={cn(needsMetaTopMargin && 'mt-3')}>
            <DetailsList details={fields.meta} />
          </div>
        )}
        {fields.diagnostics.length > 0 && (
          <>
            <Button
              variant="unstyled"
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="mt-3 flex items-center gap-1 rounded-md text-2xs text-text-tertiary transition-colors hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
            >
              <ChevronRight
                className={cn(
                  'h-3 w-3 transition-transform duration-150',
                  showDetails && 'rotate-90',
                )}
              />
              {showDetails ? 'Hide details' : 'Show details'}
            </Button>
            {showDetails && (
              <div className="mt-2">
                <DetailsList details={fields.diagnostics} />
              </div>
            )}
          </>
        )}
        {!hasAnyContent && (
          <p className="text-center text-xs italic text-text-tertiary dark:text-text-dark-tertiary">
            No parameters
          </p>
        )}
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
