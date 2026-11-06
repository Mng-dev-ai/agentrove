import { useState } from 'react';
import { Plus, Route, X } from 'lucide-react';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { updateMachineRoutes } from '@/services/machineActions';
import type { Machine } from '@/types/machine.types';
import styles from './AddMachineDialog.module.scss';

export function EditRoutesDialog({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const [urls, setUrls] = useState(() => machine.routes.map((route) => route.url));
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    try {
      updateMachineRoutes(machine.id, urls.map((url) => url.trim()).filter(Boolean));
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Invalid routes');
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} size="sm" ariaLabel="Edit routes">
      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles['icon-box']}>
            <Route className={styles['header-icon']} />
          </div>
          <h3 className={styles.title}>Routes for {machine.name}</h3>
        </div>
        {error && (
          <div className={styles.error} role="alert">
            <p>{error}</p>
          </div>
        )}
        <div className={styles.fields}>
          <p className={styles.hint}>
            Tried in order; the first route that answers is used. https only.
          </p>
          {urls.map((url, index) => (
            <div key={index} className={styles['route-row']}>
              <Input
                value={url}
                onChange={(e) => {
                  setError(null);
                  setUrls((current) =>
                    current.map((value, i) => (i === index ? e.target.value : value)),
                  );
                }}
                placeholder="https://machine.tailnet.ts.net"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="unstyled"
                className={styles['icon-button']}
                onClick={() => setUrls((current) => current.filter((_, i) => i !== index))}
                aria-label="Remove route"
                disabled={urls.length === 1}
              >
                <X className={styles['help-chevron']} />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setUrls((current) => [...current, ''])}
            className={styles['add-route']}
          >
            <Plus className={styles['help-chevron']} />
            Add route
          </Button>
        </div>
      </div>
      <DialogFooter onCancel={onClose} onSave={handleSave} saveLabel="Save" bordered />
    </BaseModal>
  );
}
