import { useState, useRef, useEffect } from 'react';
import { claimEscape } from '@/components/ui/shared/BaseModal/useModalLayer';

// Open dropdowns in open order; only the last one answers Escape.
const openStack: HTMLDivElement[] = [];

export const useDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = dropdownRef.current;
    if (!isOpen || !root) return;
    let hadFocus = root.contains(document.activeElement);
    openStack.push(root);

    const handleFocusIn = () => {
      hadFocus = true;
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (!root.contains(event.target as Node)) {
        hadFocus = false;
        setIsOpen(false);
      }
    };
    // Document bubble runs before BaseModal's window listener, which skips
    // prevented Escapes — so the panel closes and the dialog stays open.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (openStack[openStack.length - 1] === root && claimEscape(event, root)) setIsOpen(false);
    };

    root.addEventListener('focusin', handleFocusIn);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      root.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      openStack.splice(openStack.indexOf(root), 1);
      // Focus inside the panel drops to the body when the panel unmounts; hand it back to the trigger.
      const active = document.activeElement;
      if (hadFocus && (!active || active === document.body)) {
        root.querySelector<HTMLElement>('button')?.focus();
      }
    };
  }, [isOpen]);

  return { isOpen, dropdownRef, setIsOpen };
};
