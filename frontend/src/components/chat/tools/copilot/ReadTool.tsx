import { memo } from 'react';
import { FileSearch, FolderSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { NumberedContent } from '../common/NumberedContent/NumberedContent';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import toolIcon from './toolIcon.module.scss';
import styles from './ReadTool.module.scss';
import type { CopilotReadInput, CopilotToolOutput } from './copilotPayload';

// Copilot-via-Claude models prefix each line with "N. "; GPT models return raw
// content and we fall back to the array index in NumberedContent.
const LINE_NUMBER_PREFIX = /^(\d+)\.\s?/;

const ReadToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as CopilotReadInput | undefined;
  const result = tool.result as CopilotToolOutput | undefined;

  // Copilot uses a single `read` kind for file/dir views and glob searches;
  // the `pattern` field is the discriminator.
  const isGlob = typeof input?.pattern === 'string' && input.pattern.length > 0;
  const path = input?.path ?? '';
  const pattern = input?.pattern ?? '';
  const content = result?.content ?? '';
  const fileLabel = path ? extractFilename(path) : 'file';

  const icon = isGlob ? (
    <FolderSearch className={toolIcon.icon} />
  ) : (
    <FileSearch className={toolIcon.icon} />
  );

  return (
    <ToolCard
      icon={icon}
      status={tool.status}
      title={(status) => {
        if (isGlob) {
          const label = path ? `'${pattern}' in ${path}` : `'${pattern}'`;
          switch (status) {
            case 'completed':
              return `Found ${label}`;
            case 'failed':
              return `Search failed: ${label}`;
            default:
              return `Searching ${label}`;
          }
        }
        switch (status) {
          case 'completed':
            return `Read ${fileLabel}`;
          case 'failed':
            return `Failed to read ${fileLabel}`;
          default:
            return `Reading ${fileLabel}`;
        }
      }}
      loadingContent={isGlob ? 'Searching...' : 'Loading file content...'}
      error={tool.error}
      actions={!isGlob && path ? <OpenInEditorButton filePath={path} /> : null}
    >
      {(path || pattern || content) && (
        <div className={styles.details}>
          {path && !isGlob && <div className={styles.path}>{path}</div>}
          {content && <NumberedContent content={content} prefixPattern={LINE_NUMBER_PREFIX} />}
        </div>
      )}
    </ToolCard>
  );
};

export const ReadTool = memo(ReadToolInner);
