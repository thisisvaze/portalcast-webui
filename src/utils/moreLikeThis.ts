import type { DiscoverBrowseParams } from '@/api/endpoints/discover';

export interface MoreLikeThisTier {
  params: Omit<DiscoverBrowseParams, 'page'>;
}

/** Splits a comma-separated genres_str into trimmed, unique genre names. */
export function parseGenres(genresStr?: string | null): string[] {
  if (!genresStr) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(genresStr).split(',')) {
    const g = raw.trim();
    if (!g) continue;
    const key = g.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

/**
 * Infers the most common genres from the server's /similar items when the opened
 * title itself lacked genres_str (e.g. opened from Continue Watching hero Details).
 */
export function inferGenresFromItems(
  items: ReadonlyArray<{ genres_str?: string }>,
  limit = 2
): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    for (const g of parseGenres(item.genres_str)) {
      const key = g.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { label: g, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => e.label);
}

/**
 * Progressive /api/v2/discover/browse tiers after the initial 20 /similar matches:
 * narrow multi-genre intersection first, then individual genres, then same-type catalog.
 */
export function buildMoreLikeThisTiers(
  type: 'movie' | 'series',
  genres: ReadonlyArray<string>
): MoreLikeThisTier[] {
  const tiers: MoreLikeThisTier[] = [];
  if (genres.length >= 2) {
    tiers.push({ params: { type, genre: `${genres[0]},${genres[1]}` } });
  }
  for (const g of genres.slice(0, 3)) {
    tiers.push({ params: { type, genre: g } });
  }
  if (tiers.length === 0) {
    tiers.push({ params: { type } });
  }
  return tiers;
}

/** Appends items whose string id is not already in `seen`, mutating `seen` in place. */
export function filterNewUniqueItems<T extends { id?: string | number }>(
  incoming: ReadonlyArray<T>,
  seen: Set<string>
): T[] {
  const fresh: T[] = [];
  for (const item of incoming) {
    if (item.id === undefined || item.id === null) continue;
    const key = String(item.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
  }
  return fresh;
}
