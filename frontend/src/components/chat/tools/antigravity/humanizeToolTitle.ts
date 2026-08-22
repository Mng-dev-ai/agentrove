export const humanizeToolTitle = (title: string): string =>
  title
    .replace(/^Running\s+/i, '')
    .replace(/_/g, ' ')
    .trim();
