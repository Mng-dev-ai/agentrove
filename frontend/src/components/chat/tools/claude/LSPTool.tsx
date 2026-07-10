import { memo } from 'react';
import { Code } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename, formatResult } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import styles from './LSPTool.module.scss';

type LSPOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'goToImplementation'
  | 'prepareCallHierarchy'
  | 'incomingCalls'
  | 'outgoingCalls';

interface LSPInput {
  operation: LSPOperation;
  filePath: string;
  line?: number;
  character?: number;
}

const LSPToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as LSPInput | undefined;
  const operation = input?.operation;
  const filePath = input?.filePath ?? '';
  const line = input?.line;
  const character = input?.character;

  const filename = extractFilename(filePath);
  const location =
    line !== undefined ? `:${line}${character !== undefined ? `:${character}` : ''}` : '';
  const opLabel = operation ?? 'query';

  const result = formatResult(tool.result);

  return (
    <ToolCard
      icon={<Code className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `LSP ${opLabel}: ${filename}${location}`;
          case 'failed':
            return `LSP ${opLabel} failed: ${filename}${location}`;
          default:
            return `LSP running ${opLabel}: ${filename}${location}`;
        }
      }}
      loadingContent={`Running ${opLabel}...`}
      error={tool.error}
    >
      {(filePath || result) && (
        <div className={styles.details}>
          {filePath && (
            <div className={styles.path}>
              {filePath}
              {location}
            </div>
          )}
          {result && <pre className={toolText['output-pre']}>{result}</pre>}
        </div>
      )}
    </ToolCard>
  );
};

export const LSPTool = memo(LSPToolInner);
