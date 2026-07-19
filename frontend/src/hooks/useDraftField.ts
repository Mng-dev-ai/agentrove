import { useRef, useState } from 'react';

// Local draft so typing isn't a mutation per keystroke; persists on blur only if changed.
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
