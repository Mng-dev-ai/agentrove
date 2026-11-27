import type { Model } from '@/types/chat.types';

// Legacy models stay listed only while in use or favorited.
export function listedModels(
  models: Model[],
  inUseIds: readonly string[],
  favoriteIds: readonly string[],
): Model[] {
  return models.filter(
    (m) => !m.legacy || inUseIds.includes(m.model_id) || favoriteIds.includes(m.model_id),
  );
}

// Favorites lead, ordered by when each model was starred, not alphabetically.
export function favoritesFirst(
  models: Model[],
  favoriteIds: readonly string[],
): { favorites: Model[]; rest: Model[] } {
  const byId = new Map(models.map((m) => [m.model_id, m]));
  const favoriteSet = new Set(favoriteIds);
  return {
    favorites: favoriteIds.map((id) => byId.get(id)).filter((m): m is Model => m !== undefined),
    rest: models.filter((m) => !favoriteSet.has(m.model_id)),
  };
}
