import { memo, useState, useRef } from 'react';
import { Bot } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { extractResultText } from '@/utils/agentTool';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { CollapsibleButton } from '../common/CollapsibleButton/CollapsibleButton';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import styles from './AgentTool.module.scss';
import type { CopilotToolOutput } from './copilotPayload';

interface CopilotAgentInput {
  description?: string;
  agent_type?: string;
  name?: string;
  prompt?: string;
}

const AgentToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const prevToolIdRef = useRef(tool.id);

  if (prevToolIdRef.current !== tool.id) {
    prevToolIdRef.current = tool.id;
    setPromptExpanded(false);
    setResultExpanded(false);
  }

  const input = tool.input as CopilotAgentInput | undefined;
  const output = tool.result as CopilotToolOutput | undefined;
  const description = input?.description?.trim() || tool.title?.trim() || '';
  const agentType = input?.agent_type?.trim();
  const agentName = input?.name?.trim();
  const prompt = input?.prompt;
  // `output.content` is the sub-agent's summary text; fall back to the Claude
  // tool utility which handles other structured result shapes.
  const result = output?.content?.trim() || extractResultText(tool.result);

  return (
    <ToolCard
      icon={<Bot className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        const label = description || agentName || agentType || 'agent task';
        switch (status) {
          case 'completed':
            return `Agent: ${label}`;
          case 'failed':
            return `Agent failed: ${label}`;
          default:
            return `Running agent: ${label}`;
        }
      }}
      loadingContent="Running sub-agent..."
      error={tool.error}
    >
      {(agentType || agentName || prompt || result) && (
        <div className={styles.stack}>
          {(agentType || agentName) && (
            <div className={styles['meta-row']}>
              {agentType && (
                <span>
                  <span className={styles['meta-label']}>type: </span>
                  <span className={styles['meta-value']}>{agentType}</span>
                </span>
              )}
              {agentName && (
                <span>
                  <span className={styles['meta-label']}>name: </span>
                  <span className={styles['meta-value']}>{agentName}</span>
                </span>
              )}
            </div>
          )}

          {prompt && (
            <div className={styles.stack}>
              <CollapsibleButton
                label="Prompt"
                isExpanded={promptExpanded}
                onToggle={() => setPromptExpanded((v) => !v)}
                fullWidth
              />
              {promptExpanded && <div className={toolText['agent-box']}>{prompt}</div>}
            </div>
          )}

          {result && (
            <div className={styles.stack}>
              <CollapsibleButton
                label="Result"
                isExpanded={resultExpanded}
                onToggle={() => setResultExpanded((v) => !v)}
                fullWidth
              />
              {resultExpanded && <pre className={toolText['output-pre']}>{result}</pre>}
            </div>
          )}
        </div>
      )}
    </ToolCard>
  );
};

export const AgentTool = memo(AgentToolInner);
