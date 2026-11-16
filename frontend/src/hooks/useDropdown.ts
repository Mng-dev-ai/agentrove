import { useState, useRef, useEffect } from 'react';

export const useDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = dropdownRef.current;
    if (!isOpen || !root) return;
    let hadFocus = root.contains(document.activeElement);

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
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setIsOpen(false);
    };

    root.addEventListener('focusin', handleFocusIn);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      root.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      // Focus inside the panel drops to the body when the panel unmounts; hand it back to the trigger.
      const active = document.activeElement;
      if (hadFocus && (!active || active === document.body)) {
        root.querySelector<HTMLElement>('button')?.focus();
      }
    };
  }, [isOpen]);

  return { isOpen, dropdownRef, setIsOpen };
};
