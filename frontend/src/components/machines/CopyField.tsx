import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './CopyField.module.scss';

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={styles['copy-row']}>
      <code className={styles.code}>{value}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void handleCopy()}
        aria-label={label}
      >
        {copied ? <Check className={styles.icon} /> : <Copy className={styles.icon} />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
