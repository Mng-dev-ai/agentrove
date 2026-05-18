import { useMemo, useState, Suspense } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader';
import { Spinner } from '@/components/ui/primitives/Spinner';
import type { ToolAggregate } from '@/types/tools.types';
import { AgentToolsContext } from '@/contexts/AgentToolsContext';
import { statusIndicator } from '@/components/chat/tools/common/statusIndicator';
import { getToolComponent } from '@/components/chat/tools/registry';
import { extractResultText } from '@/utils/agentTool';

interface AgentToolExpandedModalProps {
  agents: ToolAggregate[];
  initialAgentId: string;
  onClose: () => void;
}

function AgentToolExpandedModal({ agents, initialAgentId, onClose }: AgentToolExpandedModalProps) {
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
      <div className="flex max-h-[80vh] min-h-[40vh]">
        {hasSidebar && (
          <div className="w-56 flex-shrink-0 overflow-y-auto border-r border-border/50 p-2 dark:border-border-dark/50">
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
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-200 ${
                    isSelected
                      ? 'bg-surface-active dark:bg-surface-dark-active'
                      : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover'
                  }`}
                >
                  {statusIndicator[agent.status]}
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-xs text-text-primary dark:text-text-dark-primary"
                      title={type}
                    >
                      {type}
                    </div>
                    {desc && (
                      <div
                        className="truncate text-2xs text-text-quaternary dark:text-text-dark-quaternary"
                        title={desc}
                      >
                        {desc}
                      </div>
                    )}
                  </div>
                </Button>
              );
            })}
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex items-center gap-2">
            {!hasSidebar && statusIndicator[selectedAgent.status]}
            <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
              {subagentType}
            </span>
            {description && (
              <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                — {description}
              </span>
            )}
          </div>

          {prompt && (
            <div>
              <h4 className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
                Prompt
              </h4>
              <div className="whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 font-mono text-xs text-text-secondary dark:bg-white/5 dark:text-text-dark-tertiary">
                {prompt}
              </div>
            </div>
          )}

          {selectedAgent.children.length > 0 && (
            <div>
              <h4 className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
                Tool activity ({selectedAgent.children.length})
              </h4>
              <AgentToolsContext value={childAgentTools}>
                <div className="space-y-2">
                  {selectedAgent.children.map((child) => {
                    const Component = getToolComponent(child.name);
                    return (
                      <Suspense
                        key={child.id}
                        fallback={
                          <Spinner
                            size="sm"
                            className="text-text-quaternary dark:text-text-dark-quaternary"
                          />
                        }
                      >
                        <div className="border-l border-border/50 pl-3 dark:border-border-dark/50">
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
              <h4 className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
                Result
              </h4>
              <div className="whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 font-mono text-xs text-text-secondary dark:bg-white/5 dark:text-text-dark-tertiary">
                {result}
              </div>
            </div>
          )}

          {selectedAgent.status === 'failed' && selectedAgent.error && (
            <div>
              <h4 className="mb-2 text-2xs font-medium uppercase tracking-wider text-error-600 dark:text-error-400">
                Error
              </h4>
              <div className="rounded-lg bg-error-50 p-3 text-xs text-error-600 dark:bg-error-950 dark:text-error-400">
                {selectedAgent.error}
              </div>
            </div>
          )}

          {selectedAgent.status === 'started' && (
            <div className="flex items-center gap-2 text-xs text-text-quaternary dark:text-text-dark-quaternary">
              <Spinner size="sm" className="text-text-quaternary dark:text-text-dark-quaternary" />
              Agent is still running…
            </div>
          )}

          {!prompt &&
            selectedAgent.children.length === 0 &&
            !result &&
            selectedAgent.status !== 'started' &&
            selectedAgent.status !== 'failed' && (
              <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
                No details available for this agent.
              </p>
            )}
        </div>
      </div>
    </BaseModal>
  );
}

export default AgentToolExpandedModal;
