// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useState, type ReactNode } from 'react';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { useDropdown } from './useDropdown';

function Layer({ name, children }: { name: string; children?: ReactNode }) {
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  return (
    <div ref={dropdownRef}>
      <button onClick={() => setIsOpen(true)}>open {name}</button>
      {isOpen && <div data-testid={name}>{children}</div>}
    </div>
  );
}

describe('useDropdown', () => {
  it('closes only the innermost open dropdown on Escape', () => {
    render(
      <Layer name="outer">
        <Layer name="inner" />
      </Layer>,
    );
    fireEvent.click(screen.getByText('open outer'));
    fireEvent.click(screen.getByText('open inner'));

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(screen.queryByTestId('inner')).toBeNull();
    expect(screen.queryByTestId('outer')).not.toBeNull();

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(screen.queryByTestId('outer')).toBeNull();
  });

  it('leaves Escape to a modal layer opened over an open dropdown', () => {
    function Page() {
      const [modalOpen, setModalOpen] = useState(false);
      return (
        <>
          <Layer name="page" />
          <button onClick={() => setModalOpen(true)}>open modal</button>
          <BaseModal isOpen={modalOpen} onClose={() => setModalOpen(false)} ariaLabel="modal">
            <Layer name="inside" />
          </BaseModal>
        </>
      );
    }
    render(<Page />);
    fireEvent.click(screen.getByText('open page'));
    fireEvent.click(screen.getByText('open modal'));
    fireEvent.click(screen.getByText('open inside'));

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(screen.queryByTestId('inside')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeNull();

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
