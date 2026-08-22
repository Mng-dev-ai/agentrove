import { memo } from 'react';
import { FileSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename, humanizeToolTitle } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { OpenInEditorButton } from '../common/OpenInEditorButton/OpenInEditorButton';
import type { AntigravityReadInput } from './antigravityPayload';
import styles from './ReadTool.module.scss';

export const ReadTool = memo(function ReadTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as AntigravityReadInput | undefined;
  const filePath = input?.AbsolutePath ?? input?.absolute_path ?? '';
  const label = filePath ? extractFilename(filePath) : humanizeToolTitle(tool.title) || 'file';

  return (
    <ToolCard
      icon={<FileSearch className={styles.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Read ${label}`;
          case 'failed':
            return `Failed to read ${label}`;
          default:
            return `Reading ${label}`;
        }
      }}
      loadingContent="Reading file..."
      error={tool.error}
      actions={filePath ? <OpenInEditorButton filePath={filePath} /> : null}
    >
      {filePath && <div className={styles.path}>{filePath}</div>}
    </ToolCard>
  );
});
