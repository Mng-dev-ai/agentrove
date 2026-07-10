import { memo } from 'react';
import { FolderSearch } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { SearchLoadingDots } from '../common/SearchLoadingDots/SearchLoadingDots';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import type { OpencodeGlobInput, OpencodeGlobMetadata, OpencodeOutput } from './opencodePayload';

const ICON = <FolderSearch className={toolIcon.icon} />;

const GlobToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as OpencodeGlobInput | undefined;
  const result = tool.result as OpencodeOutput | undefined;
  const metadata = result?.metadata as OpencodeGlobMetadata | undefined;

  const pattern = input?.pattern ?? tool.title?.trim() ?? 'pattern';
  const count = metadata?.count;
  const truncated = metadata?.truncated ?? false;
  const output = result?.output ?? '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed': {
            if (typeof count !== 'number') return `Globbed "${pattern}"`;
            const suffix = truncated ? '+' : '';
            return `Found ${count}${suffix} file${count === 1 ? '' : 's'}`;
          }
          case 'failed':
            return `Glob failed: ${pattern}`;
          default:
            return `Matching "${pattern}"...`;
        }
      }}
      loadingContent={<SearchLoadingDots label="Finding files" />}
      error={tool.error}
    >
      {output && typeof count === 'number' && count > 0 && (
        <pre className={toolText['output-pre']}>{output}</pre>
      )}
    </ToolCard>
  );
};

export const GlobTool = memo(GlobToolInner);
