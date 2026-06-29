import { useRef, useState } from 'react';

// Holds a local draft so typing doesn't fire a mutation per keystroke.
// Re-syncs from savedValue on external updates; persists only when the value changed on blur.
export function useDraftField(savedValue: string, onPersist: (value: string) => void) {
  const [draft, setDraft] = useState(savedValue);
  const prevSavedRef = useRef(savedValue);
  if (prevSavedRef.current !== savedValue) {
    prevSavedRef.current = savedValue;
    setDraft(savedValue);
  }

  const handleBlur = () => {
    if (draft !== savedValue) onPersist(draft);
  };

  return { draft, setDraft, handleBlur };
}
