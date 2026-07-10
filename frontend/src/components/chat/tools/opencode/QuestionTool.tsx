import { memo } from 'react';
import { HelpCircle } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import toolIcon from './toolIcon.module.scss';
import type { OpencodeQuestionInput, OpencodeQuestionOutput } from './opencodePayload';
import styles from './QuestionTool.module.scss';

const ICON = <HelpCircle className={toolIcon.icon} />;

export const QuestionTool = memo(function QuestionTool({ tool }: { tool: ToolAggregate }) {
  const input = tool.input as OpencodeQuestionInput | undefined;
  const result = tool.result as OpencodeQuestionOutput | undefined;

  const questions = input?.questions ?? [];
  const answers = result?.metadata?.answers ?? [];
  const count = questions.length;

  return (
    <ToolCard
      icon={ICON}
      status={tool.status}
      title={(status) => {
        const noun = `${count} question${count === 1 ? '' : 's'}`;
        switch (status) {
          case 'completed':
            return `Answered ${noun}`;
          case 'failed':
            return `Failed to ask ${noun}`;
          default:
            return `Waiting on ${noun}...`;
        }
      }}
      loadingContent="Waiting for answer..."
      error={tool.error}
    >
      {count > 0 && (
        <div className={styles.list}>
          {questions.map((q, idx) => {
            const answer = answers[idx];
            const answerText = answer && answer.length > 0 ? answer.join(', ') : 'Unanswered';
            return (
              <div key={idx} className={styles.item}>
                <div className={styles.question}>{q.question ?? q.header ?? ''}</div>
                <div className={styles.answer}>
                  <span className={styles['answer-label']}>answer: </span>
                  {answerText}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ToolCard>
  );
});
