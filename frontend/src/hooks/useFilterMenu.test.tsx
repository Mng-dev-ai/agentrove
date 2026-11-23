// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useFilterMenu } from '@/hooks/useFilterMenu';

function Layout() {
  const menu = useFilterMenu();
  return (
    <>
      <div data-testid="sidebar-scroll">
        <div ref={menu.triggerRef}>
          <button onClick={menu.open}>open</button>
        </div>
      </div>
      <div data-testid="chat-scroll" />
      {menu.isOpen && <div data-testid="panel" />}
    </>
  );
}

describe('useFilterMenu scroll close', () => {
  it('stays open when an unrelated element scrolls and closes when the trigger scrolls', () => {
    render(<Layout />);
    fireEvent.click(screen.getByText('open'));

    fireEvent.scroll(screen.getByTestId('chat-scroll'));
    expect(screen.queryByTestId('panel')).not.toBeNull();

    fireEvent.scroll(screen.getByTestId('sidebar-scroll'));
    expect(screen.queryByTestId('panel')).toBeNull();
  });
});
