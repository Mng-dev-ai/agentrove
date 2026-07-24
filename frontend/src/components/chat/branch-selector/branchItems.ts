import type { DropdownItemType } from '@/components/ui/primitives/Dropdown/Dropdown';

// Current branch pinned first (no header), the rest under a "Branches" header.
export function buildBranchItems(
  branches: string[],
  currentBranch: string,
): DropdownItemType<string>[] {
  const others = branches.filter((b) => b !== currentBranch);
  const items: DropdownItemType<string>[] = [{ type: 'item', data: currentBranch }];
  if (others.length > 0) {
    items.push({ type: 'header', label: 'Branches' });
    others.forEach((b) => items.push({ type: 'item', data: b }));
  }
  return items;
}

export const shortenBranchName = (branch: string) =>
  branch.length > 16 ? branch.slice(0, 16) + '…' : branch;
