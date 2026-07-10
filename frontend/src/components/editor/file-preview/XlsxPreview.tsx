import { memo, useState } from 'react';
import clsx from 'clsx';
import { logger } from '@/utils/logger';
import { base64ToUint8Array } from '@/utils/base64';
import type { FileStructure } from '@/types/file-system.types';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { PreviewContainer } from './PreviewContainer';
import { PreviewEmptyState } from './PreviewEmptyState';
import { previewBackgroundClass, tableBorderClass } from './previewConstants';
import { getDisplayFileName, isValidBase64 } from './previewUtils';
import styles from './XlsxPreview.module.scss';

export interface XlsxPreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

type SpreadsheetData = Array<Array<{ value: string }>>;

interface WorksheetData {
  name: string;
  data: SpreadsheetData;
}

export const XlsxPreview = memo(function XlsxPreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: XlsxPreviewProps) {
  const [activeSheet, setActiveSheet] = useState(0);
  const [worksheetData, setWorksheetData] = useState<WorksheetData[]>([]);
  const fileName = getDisplayFileName(file, 'spreadsheet');

  useAsyncEffect(
    async (cancelled) => {
      setWorksheetData([]);
      setActiveSheet(0);

      if (!file.content || !isValidBase64(file.content)) {
        return;
      }

      try {
        const XLSX = await import('xlsx');
        if (cancelled()) return;

        const bytes = base64ToUint8Array(file.content!);
        const workbook = XLSX.read(bytes, { type: 'array' });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          setWorksheetData([]);
          return;
        }

        const worksheets: WorksheetData[] = workbook.SheetNames.map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

          let maxCols = 0;
          for (const row of jsonData as unknown[][]) {
            if (row.length > maxCols) maxCols = row.length;
          }

          const data: SpreadsheetData = (jsonData as unknown[][])
            .filter(
              (row) =>
                row.length > 0 &&
                row.some((cell) => cell !== '' && cell !== null && cell !== undefined),
            )
            .map((row: unknown[]) => {
              const paddedRow = Array(maxCols)
                .fill('')
                .map((_, index) => {
                  const cellValue = row[index];
                  return {
                    value: cellValue === null || cellValue === undefined ? '' : String(cellValue),
                  };
                });
              return paddedRow;
            });

          return { name: sheetName, data };
        });

        if (!cancelled()) setWorksheetData(worksheets);
      } catch (error) {
        logger.error('XLSX preview load failed', 'XlsxPreview', error);
        if (!cancelled()) setWorksheetData([]);
      }
    },
    [file.content],
  );

  if (worksheetData.length === 0) {
    return (
      <PreviewEmptyState
        fileName={fileName}
        message="Unable to load spreadsheet data"
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    );
  }

  const currentSheet = worksheetData[activeSheet];
  if (!currentSheet || currentSheet.data.length === 0) {
    return (
      <PreviewEmptyState
        fileName={fileName}
        message="No data to display"
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    );
  }

  const hasMultipleSheets = worksheetData.length > 1;

  return (
    <PreviewContainer
      fileName={fileName}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      disableContentWrapper
    >
      <div className={styles['xlsx-preview']}>
        {hasMultipleSheets && (
          <div className={styles.tabs}>
            {worksheetData.map((sheet, index) => (
              <Button
                key={index}
                onClick={() => setActiveSheet(index)}
                variant="unstyled"
                className={clsx(styles.tab, activeSheet === index && styles['tab--active'])}
              >
                {sheet.name}
              </Button>
            ))}
          </div>
        )}

        <div className={styles['table-wrapper']}>
          <table
            className={clsx(styles.table, tableBorderClass, isFullscreen && styles['table--full'])}
          >
            <thead className={styles.thead}>
              <tr>
                {currentSheet.data[0]?.map((_, colIndex) => (
                  <th
                    key={colIndex}
                    className={clsx(
                      tableBorderClass,
                      styles['header-cell'],
                      !isFullscreen && styles['header-cell--compact'],
                    )}
                  >
                    {(() => {
                      let result = '';
                      let num = colIndex;
                      while (num >= 0) {
                        result = String.fromCharCode(65 + (num % 26)) + result;
                        num = Math.floor(num / 26) - 1;
                        if (num < 0) break;
                      }
                      return result;
                    })()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentSheet.data.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={rowIndex % 2 === 0 ? previewBackgroundClass : styles['alt-row']}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={clsx(
                        tableBorderClass,
                        styles.cell,
                        !isFullscreen && styles['cell--compact'],
                      )}
                    >
                      <FloatingTooltip content={cell.value} className={styles['tooltip-content']}>
                        {cell.value || ''}
                      </FloatingTooltip>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.footer}>
          <div className={styles['footer-text']}>
            {currentSheet.data.length} rows ×{' '}
            {currentSheet.data.reduce((max, row) => Math.max(max, row.length), 0)} columns
          </div>
        </div>
      </div>
    </PreviewContainer>
  );
});
