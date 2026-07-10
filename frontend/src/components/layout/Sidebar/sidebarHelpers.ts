import toast from 'react-hot-toast';
import { DROPDOWN_WIDTH, DROPDOWN_HEIGHT, DROPDOWN_MARGIN } from '@/config/constants';

export async function mutateWithToast<T>(
  mutateFn: () => Promise<T>,
  successMessage: string,
  failureMessage: string,
): Promise<T> {
  try {
    const result = await mutateFn();
    toast.success(successMessage);
    return result;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : failureMessage);
    throw error;
  }
}

export function calculateDropdownPosition(buttonRect: DOMRect): { top: number; left: number } {
  const isMobile = window.innerWidth < 640;
  const spaceBelow = window.innerHeight - buttonRect.bottom;
  const spaceRight = window.innerWidth - buttonRect.right;

  let top: number;
  let left: number;

  if (isMobile) {
    top =
      spaceBelow >= DROPDOWN_HEIGHT + DROPDOWN_MARGIN
        ? buttonRect.bottom + 4
        : buttonRect.top - DROPDOWN_HEIGHT - 4;
    left = buttonRect.right - DROPDOWN_WIDTH;
  } else {
    top =
      spaceBelow >= DROPDOWN_HEIGHT + DROPDOWN_MARGIN
        ? buttonRect.top
        : buttonRect.top - DROPDOWN_HEIGHT + buttonRect.height;
    left =
      spaceRight >= DROPDOWN_WIDTH + DROPDOWN_MARGIN
        ? buttonRect.right + 4
        : buttonRect.left - DROPDOWN_WIDTH - 4;
  }

  top = Math.max(
    DROPDOWN_MARGIN,
    Math.min(top, window.innerHeight - DROPDOWN_HEIGHT - DROPDOWN_MARGIN),
  );
  left = Math.max(
    DROPDOWN_MARGIN,
    Math.min(left, window.innerWidth - DROPDOWN_WIDTH - DROPDOWN_MARGIN),
  );

  return { top, left };
}
