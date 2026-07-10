import { memo } from 'react';
import { Globe } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { SearchLoadingDots } from '../common/SearchLoadingDots/SearchLoadingDots';
import toolIcon from './toolIcon.module.scss';

const ICON = <Globe className={toolIcon.icon} />;

export const WebSearchTool = memo(function WebSearchTool({ tool }: { tool: ToolAggregate }) {
  // Grok's backend web search exposes no query in rawInput — the ACP title
  // ("Web search: <query>") is the only place the query surfaces.
  const query = tool.title?.replace(/^Web search:\s*/i, '').trim() ?? '';

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        const label = query ? `"${query}"` : 'the web';
        switch (status) {
          case 'completed':
            return `Searched ${label}`;
          case 'failed':
            return `Web search failed`;
          default:
            return `Searching ${label}...`;
        }
      }}
      loadingContent={<SearchLoadingDots label="Searching the web" />}
      error={tool.error}
    />
  );
});
