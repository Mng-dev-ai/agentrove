import { CSSProperties, ReactNode, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Plus, Loader2, LucideIcon, Edit2, Trash2 } from 'lucide-react';
import { logger } from '@/utils/logger';

// Explicit fill-mode: globals.css redefines .animate-fade-in without `forwards`,
// which would snap the spinner back to opacity-0 when the animation ends
const SPINNER_STYLE: CSSProperties = { animationDelay: '300ms', animationFillMode: 'forwards' };

interface ListManagementTabProps<T> {
  title: string;
  description: string;
  items: T[] | null;
  emptyIcon: LucideIcon;
  emptyText: string;
  emptyButtonText: string;
  addButtonText: string;
  deleteConfirmTitle: string;
  deleteConfirmMessage: (item: T) => string;
  getItemKey: (item: T, index: number) => string;
  onAdd: () => void;
  onEdit?: (index: number) => void;
  onDelete: (index: number) => void | Promise<void>;
  renderItem: (item: T, index: number) => ReactNode;
  // Extra controls rendered before the edit/delete buttons (e.g. an enable toggle)
  renderItemActions?: (item: T, index: number) => ReactNode;
  footerContent?: ReactNode;
  logContext: string;
}

export const ListManagementTab = <T,>({
  title,
  description,
  items,
  emptyIcon: EmptyIcon,
  emptyText,
  emptyButtonText,
  addButtonText,
  deleteConfirmTitle,
  deleteConfirmMessage,
  getItemKey,
  onAdd,
  onEdit,
  onDelete,
  renderItem,
  renderItemActions,
  footerContent,
  logContext,
}: ListManagementTabProps<T>) => {
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  const handleCloseDeleteDialog = () => {
    setPendingDeleteIndex(null);
  };

  const handleConfirmDelete = async () => {
    if (pendingDeleteIndex === null) return;
    setDeletingIndex(pendingDeleteIndex);
    try {
      await onDelete(pendingDeleteIndex);
      setPendingDeleteIndex(null);
    } catch (error) {
      logger.error(`Failed to delete item`, logContext, error);
    } finally {
      setDeletingIndex(null);
    }
  };

  const deleteTargetItem =
    pendingDeleteIndex !== null && items?.[pendingDeleteIndex] ? items[pendingDeleteIndex] : null;

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              {title}
            </h2>
            <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {description}
            </p>
          </div>
          <Button
            type="button"
            onClick={onAdd}
            variant="outline"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            {addButtonText}
          </Button>
        </div>

        {items === null ? (
          // null means the list is still loading — stay invisible for 300ms so
          // fast loads render nothing instead of flashing a spinner
          <div
            className="flex animate-fade-in justify-center rounded-xl border border-dashed border-border py-10 opacity-0 dark:border-border-dark"
            style={SPINNER_STYLE}
          >
            <Loader2 className="h-4 w-4 animate-spin text-text-quaternary dark:text-text-dark-quaternary" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 text-center dark:border-border-dark">
            <EmptyIcon className="mx-auto mb-3 h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <p className="mb-3 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {emptyText}
            </p>
            <Button type="button" onClick={onAdd} variant="outline" size="sm">
              {emptyButtonText}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <div
                key={getItemKey(item, index)}
                className="group rounded-xl border border-border p-4 transition-colors duration-200 hover:border-border-hover dark:border-border-dark dark:hover:border-border-dark-hover"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
                  <div className="ml-3 flex items-center gap-0.5">
                    {renderItemActions?.(item, index)}
                    {onEdit && (
                      <Button
                        type="button"
                        onClick={() => onEdit(index)}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                        aria-label="Edit item"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() => setPendingDeleteIndex(index)}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                      aria-label="Delete item"
                      disabled={deletingIndex === index}
                    >
                      {deletingIndex === index ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {footerContent}
      </div>

      <ConfirmDialog
        isOpen={pendingDeleteIndex !== null}
        onClose={handleCloseDeleteDialog}
        onConfirm={handleConfirmDelete}
        title={deleteConfirmTitle}
        message={
          deleteTargetItem
            ? deleteConfirmMessage(deleteTargetItem)
            : 'Are you sure you want to delete this item? This action cannot be undone.'
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
};
