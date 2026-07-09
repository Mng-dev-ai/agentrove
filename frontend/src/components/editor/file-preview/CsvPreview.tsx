import { memo, useMemo } from 'react';
import clsx from 'clsx';
import type { FileStructure } from '@/types/file-system.types';
import { PreviewContainer } from './PreviewContainer';
import { PreviewEmptyState } from './PreviewEmptyState';
import { previewBackgroundClass, tableBorderClass } from './previewConstants';
import { getDisplayFileName } from './previewUtils';
import styles from './CsvPreview.module.scss';

export interface CsvPreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const CsvPreview = memo(function CsvPreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: CsvPreviewProps) {
  const parsedData = useMemo(() => {
    if (!file.content) return { headers: [], rows: [] };

    const lines = file.content.split('\n').filter((line) => line.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = lines[0].split(',').map((header) => header.trim().replace(/^"|"$/g, ''));
    const rows = lines
      .slice(1)
      .map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')));

    return { headers, rows };
  }, [file.content]);

  const { headers, rows } = parsedData;

  if (headers.length === 0) {
    return (
      <PreviewEmptyState
        fileName={getDisplayFileName(file)}
        message="No CSV data to display"
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    );
  }

  return (
    <PreviewContainer
      fileName={getDisplayFileName(file)}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      contentClassName={styles.content}
    >
      <div className={styles['csv-preview']}>
        <table className={clsx(styles.table, tableBorderClass)}>
          <thead>
            <tr className={styles['header-row']}>
              {headers.map((header, index) => (
                <th key={index} className={clsx(tableBorderClass, styles['header-cell'])}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={rowIndex % 2 === 0 ? previewBackgroundClass : styles['alt-row']}
              >
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={clsx(tableBorderClass, styles.cell)}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PreviewContainer>
  );
});
