import toolText from '../common/toolText.module.scss';
import styles from './codexShellPayload.module.scss';

export type ParsedCmdType = 'list_files' | 'search' | 'read' | 'unknown';

export interface ParsedCommand {
  type?: ParsedCmdType;
  cmd: string;
  path?: string | null;
  query?: string | null;
}

export interface ShellLikeInput {
  command?: string[];
  cwd?: string;
  parsed_cmd?: ParsedCommand[];
  source?: string;
}

export interface ShellLikeOutput {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  formatted_output?: string;
  duration?: { secs: number; nanos: number };
}

export const extractCommand = (input: ShellLikeInput | undefined): string => {
  if (!input?.command) return '';
  const args = input.command;
  if (args.length >= 3 && args[1] === '-lc' && args[0].startsWith('/bin/')) {
    return args[2];
  }
  return args.join(' ');
};

export const extractOutput = (result: ShellLikeOutput | undefined): string => {
  return result?.formatted_output || result?.stdout || '';
};

export const renderCommand = (command: string): React.ReactNode => {
  if (!command) {
    return null;
  }

  return (
    <pre className={styles['command-pre']}>
      <span className={styles['command-prompt']}>$ </span>
      {command}
    </pre>
  );
};

export const renderOutput = (output: string): React.ReactNode => {
  if (!output) {
    return null;
  }

  return <pre className={toolText['output-pre']}>{output}</pre>;
};
