import { memo, useMemo } from 'react';
import { Wrench } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { formatResult, formatValue } from '@/utils/format';
import { extractToolResultImages } from '@/utils/mcpToolImages';
import { AttachmentViewer } from '@/components/ui/attachment-viewer/AttachmentViewer';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import styles from './MCPTool.module.scss';

interface MCPToolProps {
  tool: ToolAggregate;
}

const formatToolName = (toolName: string): string => {
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.slice(5).split('__');
    if (parts.length >= 2) {
      const serverName = parts[0];
      const tool = parts.slice(1).join('__');
      const formattedTool = tool
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      return `MCP: ${serverName} - ${formattedTool}`;
    }
  }

  return toolName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export const MCPTool = memo(function MCPTool({ tool }: MCPToolProps) {
  const isMcpTool = tool.name.startsWith('mcp__');
  const formattedToolName = formatToolName(tool.name);

  const toolStatus = tool.status;
  const errorMessage = tool.error;

  const description =
    !isMcpTool && typeof tool.input?.description === 'string' ? tool.input.description : null;
  const inputEntries = Object.entries(tool.input || {}).filter(
    ([key]) => !(key === 'description' && description),
  );
  const hasInput = inputEntries.length > 0;
  // Base64 image blocks (e.g. browser screenshots) render as real images; the
  // remainder is what's left for the JSON/text output.
  const { attachments: resultImages, remainder: textResult } = useMemo(
    () => extractToolResultImages(tool.id, tool.result),
    [tool.id, tool.result],
  );
  const hasImages = resultImages.length > 0;
  const hasResult = Boolean(
    textResult &&
    (Array.isArray(textResult)
      ? textResult.length > 0
      : typeof textResult === 'object'
        ? Object.keys(textResult as object).length > 0
        : true),
  );
  const hasDetails = hasInput || hasResult || hasImages;
  const title = description ? `${formattedToolName}: ${description}` : formattedToolName;

  return (
    <ToolCard
      // ToolCard reads defaultExpanded only at mount; remount when an image
      // arrives mid-stream so screenshots open without a click.
      key={hasImages ? 'image' : 'default'}
      icon={<Wrench className={toolIcon.icon} />}
      status={toolStatus}
      title={title}
      loadingContent="Processing..."
      error={errorMessage}
      defaultExpanded={hasImages || undefined}
    >
      {hasDetails ? (
        <div className={styles.details}>
          {hasInput
            ? inputEntries.map(([key, value]) => (
                <div key={key}>
                  <span className={styles.key}>{key}: </span>
                  <span className={styles.value}>{formatValue(value)}</span>
                </div>
              ))
            : null}
          {hasImages ? <AttachmentViewer attachments={resultImages} /> : null}
          {hasResult ? (
            <pre className={toolText['output-pre']}>{formatResult(textResult)}</pre>
          ) : null}
        </div>
      ) : null}
    </ToolCard>
  );
});
