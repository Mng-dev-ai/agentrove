import { memo } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import {
  buildInputSummary,
  collectLongInputFields,
  extractChatId,
  getDescriptor,
  parseAgentRoveResult,
  summarizeResultData,
} from './agentRoveDescriptors';
import toolText from '../common/toolText.module.scss';
import iconDark from '/assets/images/icon-dark.svg';
import iconLight from '/assets/images/icon-white.svg';
import styles from './AgentRoveTool.module.scss';

export const AgentRoveTool = memo(function AgentRoveTool({ tool }: { tool: ToolAggregate }) {
  const { label } = getDescriptor(tool.name);
  const summary = buildInputSummary(tool.name, tool.input);
  const longFields = collectLongInputFields(tool.name, tool.input);
  const result = parseAgentRoveResult(tool.result);
  const resultSummary = summarizeResultData(result.data);
  const chatId = extractChatId(result.data);
  const hasDetails = longFields.length > 0 || Boolean(result.text);

  return (
    <ToolCard
      icon={
        <>
          <img src={iconDark} alt="" className={clsx(styles.icon, styles['icon--on-light'])} />
          <img src={iconLight} alt="" className={clsx(styles.icon, styles['icon--on-dark'])} />
        </>
      }
      status={tool.status}
      title={`AgentRove · ${label}`}
      statusDetail={summary}
      loadingContent="Calling AgentRove…"
      error={tool.error}
    >
      {hasDetails ? (
        <div className={styles.details}>
          {longFields.map((field) => (
            <div key={field.key} className={styles.field}>
              <span className={styles['field-label']}>{field.key}</span>
              <p className={styles['field-text']}>{field.text}</p>
            </div>
          ))}
          {resultSummary && <p className={styles.summary}>{resultSummary}</p>}
          {chatId && (
            <Link to={`/chat/${chatId}`} className={styles['chat-link']}>
              Open chat
            </Link>
          )}
          {result.text && <pre className={toolText['output-pre']}>{result.text}</pre>}
        </div>
      ) : null}
    </ToolCard>
  );
});
