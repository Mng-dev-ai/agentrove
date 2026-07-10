import { memo, useMemo } from 'react';
import { FileEdit, FilePlus, FileMinus } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { DiffView } from '../common/DiffView/DiffView';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import { buildUnifiedDiff } from '../common/buildUnifiedDiff';
import toolIcon from './toolIcon.module.scss';
import type { CopilotEditInput, CopilotToolOutput } from './copilotPayload';

type EditOp = 'add' | 'update' | 'delete';

interface ParsedEdit {
  op: EditOp;
  path: string;
}

const APPLY_PATCH_HEADERS: Array<{ op: EditOp; regex: RegExp }> = [
  { op: 'add', regex: /^\*\*\* Add File: (.+)$/m },
  { op: 'update', regex: /^\*\*\* Update File: (.+)$/m },
  { op: 'delete', regex: /^\*\*\* Delete File: (.+)$/m },
];

const parseApplyPatch = (patch: string): ParsedEdit | null => {
  for (const { op, regex } of APPLY_PATCH_HEADERS) {
    const match = patch.match(regex);
    if (match) return { op, path: match[1].trim() };
  }
  return null;
};

const identifyEdit = (input: CopilotEditInput | undefined): ParsedEdit => {
  if (!input) return { op: 'update', path: '' };
  if (typeof input.raw === 'string') {
    return parseApplyPatch(input.raw) ?? { op: 'update', path: '' };
  }
  if (typeof input.file_text === 'string') {
    return { op: 'add', path: input.path ?? '' };
  }
  return { op: 'update', path: input.path ?? '' };
};

const ICON_BY_OP: Record<EditOp, React.ReactNode> = {
  add: <FilePlus className={toolIcon.icon} />,
  delete: <FileMinus className={toolIcon.icon} />,
  update: <FileEdit className={toolIcon.icon} />,
};

function PendingPreview({ input, op }: { input: CopilotEditInput; op: EditOp }) {
  if (typeof input.raw === 'string') {
    return <DiffView diff={input.raw} />;
  }
  if (op === 'add' && typeof input.file_text === 'string') {
    return <NumberedContent content={input.file_text} />;
  }
  if (typeof input.old_str === 'string' || typeof input.new_str === 'string') {
    return <DiffView diff={buildUnifiedDiff(input.old_str ?? '', input.new_str ?? '')} />;
  }
  return null;
}

export const EditTool = memo(function EditTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as CopilotEditInput | undefined;
  const result = tool.result as CopilotToolOutput | undefined;

  const parsed = useMemo(() => identifyEdit(input), [input]);
  const filePath = parsed.path;
  const fileName = filePath ? extractFilename(filePath) : 'file';
  const diff = result?.detailedContent ?? '';

  return (
    <ToolCard
      icon={ICON_BY_OP[parsed.op]}
      status={tool.status}
      title={(status) => {
        const { label, verb } =
          parsed.op === 'add'
            ? { label: 'Created', verb: 'Creating' }
            : parsed.op === 'delete'
              ? { label: 'Deleted', verb: 'Deleting' }
              : { label: 'Edited', verb: 'Editing' };
        switch (status) {
          case 'completed':
            return `${label} ${fileName}`;
          case 'failed':
            return `Failed to ${verb.toLowerCase()} ${fileName}`;
          default:
            return `${verb} ${fileName}`;
        }
      }}
      loadingContent={
        parsed.op === 'add'
          ? 'Creating file...'
          : parsed.op === 'delete'
            ? 'Removing file...'
            : 'Applying changes...'
      }
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {diff ? (
        <DiffView diff={diff} />
      ) : input ? (
        <PendingPreview input={input} op={parsed.op} />
      ) : null}
    </ToolCard>
  );
});
