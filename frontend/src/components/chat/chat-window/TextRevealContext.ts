import { createContext } from 'react';

// Given to the reply that is streaming or has just stopped: its text segments report
// while they are still revealing, so the reply can keep its streaming presentation until
// the last words are on screen.
export interface TextReveal {
  // Nothing feeds the text any more; segments only finish what they already hold.
  streamEnded: boolean;
  begin: () => void;
  end: () => void;
}

export const TextRevealContext = createContext<TextReveal | null>(null);
