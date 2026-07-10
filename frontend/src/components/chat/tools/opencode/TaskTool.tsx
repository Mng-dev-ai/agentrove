import { memo, useMemo, useState, useRef } from 'react';
import { Bot } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { AgentToolsContext } from '@/contexts/AgentToolsContext';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { CollapsibleButton } from '../common/CollapsibleButton/CollapsibleButton';
import { getToolComponent } from '../registry';
import toolText from '../common/toolText.module.scss';
import toolIcon from './toolIcon.module.scss';
import type { OpencodeTaskInput, OpencodeOutput } from './opencodePayload';
import styles from './TaskTool.module.scss';

export const TaskTool = memo(function TaskTool({ tool }: { tool: ToolAggregate }) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const prevToolIdRef = useRef(tool.id);

  if (prevToolIdRef.current !== tool.id) {
    prevToolIdRef.current = tool.id;
    setPromptExpanded(false);
    setResultExpanded(false);
    setToolsExpanded(false);
  }

  const input = tool.input as OpencodeTaskInput | undefined;
  const result = tool.result as OpencodeOutput | undefined;

  const description = input?.description?.trim() || tool.title?.trim() || '';
  const agentType = input?.subagent_type?.trim();
  const prompt = input?.prompt;
  const output = result?.output?.trim();

  // Scope the sibling context to nested task tools so an expanded view sees
  // siblings at its own level, not the parent message's top-level list.
  const childTaskTools = useMemo(
    () => tool.children.filter((c) => c.name === 'task'),
    [tool.children],
  );

  return (
    <ToolCard
      icon={<Bot className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        const label = description || agentType || 'agent task';
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
      {(agentType || prompt || output || tool.children.length > 0) && (
        <div className={styles.stack}>
          {agentType && (
            <div className={styles['type-row']}>
              <span className={styles['type-label']}>type: </span>
              <span className={styles['type-value']}>{agentType}</span>
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

          {output && (
            <div className={styles.stack}>
              <CollapsibleButton
                label="Result"
                isExpanded={resultExpanded}
                onToggle={() => setResultExpanded((v) => !v)}
                fullWidth
              />
              {resultExpanded && <pre className={toolText['output-pre']}>{output}</pre>}
            </div>
          )}

          {tool.children.length > 0 && (
            <div className={styles.stack}>
              <CollapsibleButton
                label="Tools Used"
                isExpanded={toolsExpanded}
                onToggle={() => setToolsExpanded((v) => !v)}
                count={tool.children.length}
                fullWidth
              />
              {toolsExpanded && (
                <AgentToolsContext value={childTaskTools}>
                  <div className={styles.stack}>
                    {tool.children.map((childTool) => {
                      const Component = getToolComponent(childTool.name, 'opencode');
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
  );
});
