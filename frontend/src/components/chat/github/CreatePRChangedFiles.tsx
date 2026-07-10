import styles from './CreatePRChangedFiles.module.scss';

interface CreatePRChangedFilesProps {
  files: Array<{ path: string; additions: number; deletions: number }>;
}

export function CreatePRChangedFiles({ files }: CreatePRChangedFilesProps) {
  return (
    <div className={styles['create-pr-changed-files']}>
      {files.map((f) => (
        <div key={f.path} className={styles.row}>
          <span className={styles.path}>{f.path}</span>
          <span className={styles.stat}>
            +{f.additions} −{f.deletions}
          </span>
        </div>
      ))}
    </div>
  );
}
