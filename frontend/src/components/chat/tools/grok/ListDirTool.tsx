import { memo } from 'react';
import { FolderOpen } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractFilename } from '@/utils/format';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import type { GrokListDirInput, GrokListDirOutput } from './grokPayload';

const ICON = <FolderOpen className={toolIcon.icon} />;

export const ListDirTool = memo(function ListDirTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as GrokListDirInput | undefined;
  const result = tool.result as GrokListDirOutput | undefined;

  const dirPath = input?.target_directory ?? '';
  const dirName = dirPath ? extractFilename(dirPath) : 'directory';
  const listing = typeof result?.Content === 'string' ? result.Content : '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Listed ${dirName}`;
          case 'failed':
            return `Failed to list ${dirName}`;
          default:
            return `Listing ${dirName}...`;
        }
      }}
      loadingContent="Listing directory..."
      error={tool.error}
    >
      {listing && <pre className={toolText['output-pre']}>{listing}</pre>}
    </ToolCard>
  );
});
