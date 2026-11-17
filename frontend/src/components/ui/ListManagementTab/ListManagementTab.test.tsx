// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Server } from 'lucide-react';
import { ListManagementTab } from './ListManagementTab';

function Harness() {
  const [items, setItems] = useState(['alpha', 'beta', 'gamma']);
  return (
    <ListManagementTab<string>
      title="Things"
      description="Things"
      items={items}
      emptyIcon={Server}
      emptyText="None"
      addButtonText="Add"
      deleteConfirmTitle="Delete thing"
      deleteConfirmMessage={(item) => `Delete ${item}?`}
      getItemKey={(item) => item}
      onAdd={() => undefined}
      onDelete={(index) => {
        setItems((prev) => prev.filter((_, i) => i !== index));
        return new Promise(() => undefined);
      }}
      renderItem={(item) => <span>{item}</span>}
      logContext="test"
    />
  );
}

describe('ListManagementTab', () => {
  it('does not mark the row that shifts into a deleted index as deleting', () => {
    render(<Harness />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete item' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.queryByText('beta')).toBeNull();
    for (const button of screen.getAllByRole('button', { name: 'Delete item' })) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });
});
