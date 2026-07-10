import { memo } from 'react';
import { Image, Users } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import type { MessageAttachment } from '@/types/chat.types';
import { AttachmentViewer } from '@/components/ui/attachment-viewer/AttachmentViewer';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { MCPTool } from '../claude/MCPTool';
import styles from './OtherTool.module.scss';

// codex-acp emits ACP kind "other" for two distinct item types: image
// generation and collab-agent tool calls. Dispatch on payload shape here since
// the kind alone can't tell them apart.

interface ImageGenerationOutput {
  status?: string;
  revisedPrompt?: string | null;
  // Base64-encoded PNG of the generated image.
  result?: string;
  savedPath?: string | null;
}

interface CollabAgentInput {
  prompt?: string;
  senderThreadId?: string;
  receiverThreadIds?: string[];
  agentsStates?: Record<string, unknown>;
}

const ImageGenerationTool = memo(function ImageGenerationTool({ tool }: { tool: ToolAggregate }) {
  const output = (tool.result ?? {}) as ImageGenerationOutput;
  const imageData = typeof output.result === 'string' ? output.result.trim() : '';
  const attachments: MessageAttachment[] = imageData
    ? [
        {
          id: tool.id,
          file_url: `data:image/png;base64,${imageData}`,
          file_type: 'image',
          filename: 'generated-image.png',
          message_id: '',
          created_at: '',
        },
      ]
    : [];

  return (
    <ToolCard
      // ToolCard reads defaultExpanded only at mount; remount when the image
      // arrives mid-stream so the finished image opens without a click.
      key={attachments.length > 0 ? 'image' : 'pending'}
      icon={<Image className={styles.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return 'Generated image';
          case 'failed':
            return 'Image generation failed';
          default:
            return 'Generating image';
        }
      }}
      loadingContent="Generating image..."
      error={tool.error}
      defaultExpanded={attachments.length > 0}
    >
      {(output.revisedPrompt || attachments.length > 0) && (
        <div className={styles.body}>
          {output.revisedPrompt && <p className={styles.prompt}>{output.revisedPrompt}</p>}
          {attachments.length > 0 && <AttachmentViewer attachments={attachments} />}
        </div>
      )}
    </ToolCard>
  );
});

const CollabAgentTool = memo(function CollabAgentTool({ tool }: { tool: ToolAggregate }) {
  const input = (tool.input ?? {}) as CollabAgentInput;
  const agentStates = input.agentsStates ?? {};
  const agentRows = Object.entries(agentStates).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  // The adapter puts the collab tool name (e.g. "spawn_agent") in title.
  const label = tool.title?.trim() || 'Collab agent';

  return (
    <ToolCard
      icon={<Users className={styles.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return label;
          case 'failed':
            return `${label} failed`;
          default:
            return `Running ${label}`;
        }
      }}
      loadingContent="Coordinating agents..."
      error={tool.error}
    >
      {(input.prompt || agentRows.length > 0) && (
        <div className={styles.body}>
          {input.prompt && <p className={styles.prompt}>{input.prompt}</p>}
          {agentRows.length > 0 && (
            <div className={styles.agents}>
              {agentRows.map(([agentId, state]) => (
                <div key={agentId} className={styles['agent-row']}>
                  <span className={styles['agent-id']}>{agentId}</span>
                  <span className={styles['agent-state']}>{state}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ToolCard>
  );
});

export const OtherTool = memo(function OtherTool({ tool }: { tool: ToolAggregate }) {
  if (tool.title === 'Image generation') {
    return <ImageGenerationTool tool={tool} />;
  }
  const input = tool.input as CollabAgentInput | undefined;
  if (input && (input.senderThreadId !== undefined || input.agentsStates !== undefined)) {
    return <CollabAgentTool tool={tool} />;
  }
  return <MCPTool tool={tool} />;
});
