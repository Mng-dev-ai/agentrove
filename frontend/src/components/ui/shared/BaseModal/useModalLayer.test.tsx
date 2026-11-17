// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel';
import { useFilterMenu } from '@/hooks/useFilterMenu';
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

  it('leaves focus on body when the trigger is gone', () => {
    const { container } = render(<Page keepTrigger={false} />);
    openAndEscape();
    expect(document.activeElement).toBe(document.body);
    expect(container.querySelector('#main-content')!.hasAttribute('tabindex')).toBe(false);
  });

  it('leaves focus on body when the dialog was opened from body', () => {
    const { container } = render(<Page keepTrigger />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(document.body);
    expect(container.querySelector('#main-content')!.hasAttribute('tabindex')).toBe(false);
  });
});

const anchorAtOrigin = () => ({ top: 0, left: 0 });

function FilterMenu({ name }: { name: string }) {
  const menu = useFilterMenu({ closeOnEscape: true });
  return (
    <div ref={menu.triggerRef}>
      <button onClick={menu.open}>open {name}</button>
      {menu.isOpen && <div data-testid={name} />}
    </div>
  );
}

function AnchoredPanel({ name }: { name: string }) {
  const panel = useAnchoredPanel(anchorAtOrigin);
  return (
    <>
      <button ref={panel.triggerRef} onClick={panel.toggle}>
        open {name}
      </button>
      {panel.isOpen && <div ref={panel.panelRef} data-testid={name} />}
    </>
  );
}

function Layers({ Panel }: { Panel: (props: { name: string }) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Panel name="page" />
      <button onClick={() => setOpen(true)}>open dialog</button>
      <BaseModal isOpen={open} onClose={() => setOpen(false)} ariaLabel="dialog">
        <Panel name="inside" />
      </BaseModal>
    </>
  );
}

const pressEscape = () =>
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  });

describe.each([
  ['useFilterMenu', FilterMenu],
  ['useAnchoredPanel', AnchoredPanel],
])('%s Escape layering', (_, Panel) => {
  it('leaves Escape to a dialog opened over the open panel', () => {
    render(<Layers Panel={Panel} />);
    fireEvent.click(screen.getByText('open page'));
    fireEvent.click(screen.getByText('open dialog'));

    pressEscape();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('page')).not.toBeNull();

    pressEscape();
    expect(screen.queryByTestId('page')).toBeNull();
  });

  it('closes a panel open inside a dialog before the dialog', () => {
    render(<Layers Panel={Panel} />);
    fireEvent.click(screen.getByText('open dialog'));
    fireEvent.click(screen.getByText('open inside'));

    pressEscape();
    expect(screen.queryByTestId('inside')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeNull();

    pressEscape();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
