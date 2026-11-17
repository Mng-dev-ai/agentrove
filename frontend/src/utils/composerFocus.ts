export function canRestoreComposerFocus(textarea: HTMLTextAreaElement): boolean {
  const active = document.activeElement;
  if (active && active !== document.body) return !!textarea.form?.contains(active);
  return !!window.getSelection()?.isCollapsed;
}
