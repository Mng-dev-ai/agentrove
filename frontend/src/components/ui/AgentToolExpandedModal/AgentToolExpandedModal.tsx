import { useMemo, useState, Suspense } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader/ModalHeader';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import type { ToolAggregate } from '@/types/tools.types';
import { AgentToolsContext } from '@/contexts/AgentToolsContext';
import { statusIndicator } from '@/components/chat/tools/common/statusIndicator';
import { getToolComponent } from '@/components/chat/tools/registry';
import { extractResultText } from '@/utils/agentTool';
import styles from './AgentToolExpandedModal.module.scss';

interface AgentToolExpandedModalProps {
  agents: ToolAggregate[];
  initialAgentId: string;
  onClose: () => void;
}

export function AgentToolExpandedModal({
  agents,
  initialAgentId,
  onClose,
}: AgentToolExpandedModalProps) {
  const [selectedId, setSelectedId] = useState(initialAgentId);

  const selectedAgent = agents.find((a) => a.id === selectedId);

  const childAgentTools = useMemo(() => {
    if (!selectedAgent) {
      throw new Error('AgentToolExpandedModal requires a selected agent');
    }

    return selectedAgent.children.filter((c) => c.name === 'Agent');
  }, [selectedAgent]);

  if (!selectedAgent) {
    throw new Error('AgentToolExpandedModal requires a selected agent');
  }

  const prompt = selectedAgent.input?.prompt as string | undefined;
  const description = selectedAgent.input?.description as string | undefined;
  const subagentType =
    (selectedAgent.input?.subagent_type as string | undefined) ?? 'general-purpose';
  const result = extractResultText(selectedAgent.result);

  const hasSidebar = agents.length > 1;

  return (
    <BaseModal isOpen={true} onClose={onClose} size="4xl" ariaLabel="Subagent detail view">
      <ModalHeader title={hasSidebar ? 'Subagents' : `Agent — ${subagentType}`} onClose={onClose} />
      <div className={styles.layout}>
        {hasSidebar && (
          <div className={styles.sidebar}>
            {agents.map((agent) => {
              const type = (agent.input?.subagent_type as string | undefined) ?? 'general-purpose';
              const desc = agent.input?.description as string | undefined;
              const isSelected = agent.id === selectedAgent.id;
              return (
                <Button
                  variant="unstyled"
                  key={agent.id}
                  type="button"
                  onClick={() => setSelectedId(agent.id)}
                  className={clsx(
                    styles['sidebar-item'],
                    isSelected && styles['sidebar-item--selected'],
                  )}
                >
                  {statusIndicator[agent.status]}
                  <div className={styles['sidebar-item-body']}>
                    <FloatingTooltip content={type} className={styles['tooltip-slot']}>
                      <div className={styles['sidebar-item-title']}>{type}</div>
                    </FloatingTooltip>
                    {desc && (
                      <FloatingTooltip content={desc} className={styles['tooltip-slot']}>
                        <div className={styles['sidebar-item-desc']}>{desc}</div>
                      </FloatingTooltip>
                    )}
                  </div>
                </Button>
              );
            })}
          </div>
        )}

        <div className={styles.detail}>
          <div className={styles['detail-head']}>
            {!hasSidebar && statusIndicator[selectedAgent.status]}
            <span className={styles['detail-type']}>{subagentType}</span>
            {description && <span className={styles['detail-desc']}>— {description}</span>}
          </div>

          {prompt && (
            <div>
              <h4 className={styles['section-header']}>Prompt</h4>
              <div className={styles['code-block']}>{prompt}</div>
            </div>
          )}

          {selectedAgent.children.length > 0 && (
            <div>
              <h4 className={styles['section-header']}>
                Tool activity ({selectedAgent.children.length})
              </h4>
              <AgentToolsContext value={childAgentTools}>
                <div className={styles['tool-list']}>
                  {selectedAgent.children.map((child) => {
                    const Component = getToolComponent(child.name);
                    return (
                      <Suspense
                        key={child.id}
                        fallback={<Spinner size="sm" className={styles.empty} />}
                      >
                        <div className={styles['tool-item']}>
                          <Component tool={child} />
                        </div>
                      </Suspense>
                    );
                  })}
                </div>
              </AgentToolsContext>
            </div>
          )}

          {result && (
            <div>
              <h4 className={styles['section-header']}>Result</h4>
              <div className={styles['code-block']}>{result}</div>
            </div>
          )}

          {selectedAgent.status === 'failed' && selectedAgent.error && (
            <div>
              <h4 className={clsx(styles['section-header'], styles['section-header--error'])}>
                Error
              </h4>
              <div className={styles['error-block']}>{selectedAgent.error}</div>
            </div>
          )}

          {selectedAgent.status === 'started' && (
            <div className={styles.running}>
              <Spinner size="sm" className={styles.empty} />
              Agent is still running…
            </div>
          )}

          {!prompt &&
            selectedAgent.children.length === 0 &&
            !result &&
            selectedAgent.status !== 'started' &&
            selectedAgent.status !== 'failed' && (
              <p className={styles.empty}>No details available for this agent.</p>
            )}
        </div>
      </div>
    </BaseModal>
  );
}
