import React, { useMemo, useState, useRef, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Bot, Maximize2 } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { CollapsibleButton } from '../common/CollapsibleButton/CollapsibleButton';
import { getToolComponent } from '../registry';
import { AgentToolsContext } from '@/contexts/AgentToolsContext';
import { extractResultText } from '@/utils/agentTool';
import { useAgentToolsContext } from '@/hooks/useAgentToolsContext';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import styles from './AgentTool.module.scss';

const LazyExpandedModal = lazy(
  () => import('@/components/ui/AgentToolExpandedModal/AgentToolExpandedModal'),
);

interface AgentToolProps {
  tool: ToolAggregate;
}

export const AgentTool: React.FC<AgentToolProps> = ({ tool }) => {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const prevToolIdRef = useRef(tool.id);

  const siblingAgents = useAgentToolsContext();

  if (prevToolIdRef.current !== tool.id) {
    prevToolIdRef.current = tool.id;
    setPromptExpanded(false);
    setResultExpanded(false);
    setToolsExpanded(false);
    setModalOpen(false);
  }

  const prompt = tool.input?.prompt as string | undefined;
  const description = tool.input?.description as string | undefined;
  const subagentType = tool.input?.subagent_type as string | undefined;

  const result = extractResultText(tool.result);
  // Scoped context for nested Agent tools so they see their own siblings
  const childAgentTools = useMemo(
    () => tool.children.filter((c) => c.name === 'Agent'),
    [tool.children],
  );

  const expandAction = (
    <FloatingTooltip content="Expand agent view" className={styles.tooltip}>
      <Button
        variant="unstyled"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setModalOpen(true);
        }}
        className={styles['expand-button']}
        aria-label="Expand agent view"
      >
        <Maximize2 className={styles['expand-icon']} />
      </Button>
    </FloatingTooltip>
  );

  return (
    <>
      <ToolCard
        icon={<Bot className={toolIcon.icon} />}
        status={tool.status}
        title={(status) => {
          const type = subagentType || 'general-purpose';
          switch (status) {
            case 'completed':
              return `Agent completed (${type})`;
            case 'failed':
              return `Agent failed (${type})`;
            case 'started':
              return `Running agent (${type})`;
            default:
              return `Agent pending (${type})`;
          }
        }}
        error={tool.error}
        statusDetail={description ? <p className={styles.description}>{description}</p> : undefined}
        actions={expandAction}
      >
        {(prompt || result || tool.children.length > 0) && (
          <div className={styles.stack}>
            {prompt && (
              <div className={styles.stack}>
                <CollapsibleButton
                  label="Prompt"
                  isExpanded={promptExpanded}
                  onToggle={() => setPromptExpanded((value) => !value)}
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
                  onToggle={() => setResultExpanded((value) => !value)}
                  fullWidth
                />
                {resultExpanded && <div className={toolText['agent-box']}>{result}</div>}
              </div>
            )}

            {tool.children.length > 0 && (
              <div className={styles.stack}>
                <CollapsibleButton
                  label="Tools Used"
                  isExpanded={toolsExpanded}
                  onToggle={() => setToolsExpanded((value) => !value)}
                  count={tool.children.length}
                  fullWidth
                />
                {toolsExpanded && (
                  <AgentToolsContext value={childAgentTools}>
                    <div className={styles.stack}>
                      {tool.children.map((childTool) => {
                        const Component = getToolComponent(childTool.name);
                        return (
                          <div key={childTool.id} className={styles['child-tool']}>
                            <Component tool={childTool} />
                          </div>
                        );
                      })}
                    </div>
                  </AgentToolsContext>
                )}
              </div>
            )}
          </div>
        )}
      </ToolCard>
      {modalOpen && (
        <Suspense fallback={null}>
          <LazyExpandedModal
            agents={siblingAgents}
            initialAgentId={tool.id}
            onClose={() => setModalOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
};
