// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { BaseModal } from './BaseModal';

function Page({ keepTrigger }: { keepTrigger: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {(keepTrigger || !open) && <button onClick={() => setOpen(true)}>open</button>}
      <main id="main-content" />
      <BaseModal isOpen={open} onClose={() => setOpen(false)} ariaLabel="dialog">
        <input aria-label="field" />
      </BaseModal>
    </>
  );
}

function openAndEscape() {
  const trigger = screen.getByText('open');
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.keyDown(window, { key: 'Escape' });
}

describe('useModalLayer focus restore', () => {
  it('returns focus to the trigger when it is still mounted', () => {
    render(<Page keepTrigger />);
    openAndEscape();
    expect(document.activeElement).toBe(screen.getByText('open'));
  });

  it('falls back to the main landmark when the trigger is gone', () => {
    const { container } = render(<Page keepTrigger={false} />);
    openAndEscape();
    const main = container.querySelector<HTMLElement>('#main-content')!;
    expect(document.activeElement).toBe(main);
    main.blur();
    expect(main.hasAttribute('tabindex')).toBe(false);
  });
});
