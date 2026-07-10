import { useState } from 'react';
import clsx from 'clsx';
import { useMountEffect } from '@/hooks/useMountEffect';
import styles from './AsciiSpinner.module.scss';

// Braille frames give a smooth terminal-style spin — the CLI-agent aesthetic,
// shown in place of a chat's icon while its agent is working.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 80;

export function AsciiSpinner({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0);
  useMountEffect(() => {
    const id = window.setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(id);
  });
  return (
    <span aria-hidden="true" className={clsx(styles['ascii-spinner'], className)}>
      {SPINNER_FRAMES[frame]}
    </span>
  );
}
