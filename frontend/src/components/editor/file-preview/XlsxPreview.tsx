import { memo, useState } from 'react';
import { logger } from '@/utils/logger';
import { base64ToUint8Array } from '@/utils/base64';
import type { FileStructure } from '@/types/file-system.types';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { PreviewContainer } from './PreviewContainer';
import { PreviewEmptyState } from './PreviewEmptyState';
import { previewBackgroundClass, tableBorderClass } from './previewConstants';
import { getDisplayFileName, isValidBase64 } from './previewUtils';

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
      <div className="flex min-h-0 flex-1 flex-col">
        {hasMultipleSheets && (
          <div className="flex h-12 shrink-0 gap-1 border-b border-border bg-surface-secondary p-2 dark:border-border-dark dark:bg-surface-dark-secondary">
            {worksheetData.map((sheet, index) => (
              <Button
                key={index}
                onClick={() => setActiveSheet(index)}
                variant="unstyled"
                className={`cursor-pointer rounded px-3 py-1 text-sm ${
                  activeSheet === index
                    ? 'bg-surface text-text-primary shadow-sm dark:bg-surface-dark dark:text-text-dark-primary'
                    : 'text-text-secondary hover:bg-surface-hover/50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover/50'
                }`}
              >
                {sheet.name}
              </Button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <table
            className={`border-collapse ${tableBorderClass} ${isFullscreen ? 'w-full' : 'w-auto'}`}
          >
            <thead className="sticky top-0 z-10 bg-surface-secondary dark:bg-surface-dark-secondary">
              <tr>
                {currentSheet.data[0]?.map((_, colIndex) => (
                  <th
                    key={colIndex}
                    className={`${tableBorderClass} px-3 py-2 text-left text-xs font-medium text-text-secondary dark:text-text-dark-secondary ${isFullscreen ? 'w-auto' : 'w-auto min-w-32'}`}
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
                  className={
                    rowIndex % 2 === 0
                      ? previewBackgroundClass
                      : 'bg-surface-secondary dark:bg-surface-dark-secondary'
                  }
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={`${tableBorderClass} break-words px-3 py-2 text-sm text-text-primary dark:text-text-dark-primary ${isFullscreen ? 'w-auto' : 'w-auto min-w-32'}`}
                    >
                      <FloatingTooltip content={cell.value} className="block">
                        {cell.value || ''}
                      </FloatingTooltip>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="h-16 shrink-0 border-t border-border bg-surface-secondary p-4 dark:border-border-dark dark:bg-surface-dark-secondary">
          <div className="text-sm text-text-secondary dark:text-text-dark-secondary">
            {currentSheet.data.length} rows ×{' '}
            {currentSheet.data.reduce((max, row) => Math.max(max, row.length), 0)} columns
          </div>
        </div>
      </div>
    </PreviewContainer>
  );
});
