export const formatResult = (result: unknown): string => {
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return '';
  return JSON.stringify(result, null, 2);
};

export const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

export const extractFilename = (path: string): string => path.split('/').pop() ?? path;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatNumberCompact(num: number): string {
  if (num < 1000) return num.toString();
  if (num < 1000000) return Math.round(num / 1000) + 'K';
  return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

// Matched pairs only so isolated chars (e.g. underscores in my_var) stay intact.
export function stripMarkdownTitle(title: string): string {
  return title
    .replace(/\*{1,2}(.+?)\*{1,2}/g, '$1')
    .replace(/_{1,2}(.+?)_{1,2}/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/`(.+?)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .trim();
}

export const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url.length > 30 ? `${url.slice(0, 27)}\u2026` : url;
  }
};
