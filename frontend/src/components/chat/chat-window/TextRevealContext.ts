import { createContext } from 'react';

// Given to the reply whose stream just ended: it keeps its streaming presentation until
// its text has revealed. The revealing text segment claims the hold and ends it once
// caught up; a hold nothing claimed ends before paint.
export interface TextReveal {
  claim: () => void;
  end: () => void;
}

export const TextRevealContext = createContext<TextReveal | null>(null);
