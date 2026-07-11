interface Window {
  pdfBlobUrls?: Record<string, boolean>;
}

// TS 5.7's lib.dom types HighlightRegistry with only forEach — add the maplike members we use
interface HighlightRegistry {
  set(name: string, highlight: Highlight): this;
  delete(name: string): boolean;
}
