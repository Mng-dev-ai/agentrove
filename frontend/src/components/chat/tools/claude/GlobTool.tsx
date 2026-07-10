import { memo } from 'react';
import { FolderSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolIcon from './toolIcon.module.scss';
import styles from './GlobTool.module.scss';

interface GlobInput {
  pattern: string;
  path?: string;
}

const parseResult = (result: unknown): string[] => {
  if (Array.isArray(result)) return result.map(String);
  if (typeof result === 'string') return result.split('\n').filter(Boolean);
  return [];
};

const GlobToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as GlobInput | undefined;
  const pattern = input?.pattern ?? '*';
  const path = input?.path;

  const files = parseResult(tool.result);
  const locationSuffix = path ? ` in ${path}` : '';

  return (
    <ToolCard
      icon={<FolderSearch className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Found: ${pattern}${locationSuffix}`;
          case 'failed':
            return `Failed to find: ${pattern}${locationSuffix}`;
          default:
            return `Finding: ${pattern}${locationSuffix}`;
        }
      }}
      loadingContent="Searching for files..."
      error={tool.error}
    >
      {files.length > 0 && (
        <div className={styles.files}>
          {files.map((file) => (
            <div key={file} className={styles.file}>
              {file}
            </div>
          ))}
        </div>
      )}
    </ToolCard>
  );
};

export const GlobTool = memo(GlobToolInner);
