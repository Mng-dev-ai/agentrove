export interface RecentSource<T> {
  items: T[];
  hasMore: boolean;
}

export function mergeRecentSources<T>(
  sources: RecentSource<T>[],
  timestamp: (item: T) => string,
): T[] {
  const time = (item: T) => Date.parse(timestamp(item));
  let floor = -Infinity;
  for (const source of sources) {
    if (source.hasMore && source.items.length > 0) {
      floor = Math.max(floor, time(source.items[source.items.length - 1]));
    }
  }
  return sources
    .flatMap((source) => source.items)
    .filter((item) => time(item) >= floor)
    .sort((a, b) => time(b) - time(a));
}
