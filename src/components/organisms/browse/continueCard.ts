import { useState } from 'react';
import { toast } from 'react-toastify';
import type { MediaItem } from '@/types';
import { URL_PATHS } from '@/api/config';
import { getSeries } from '@/api/endpoints/series';
import { getMedia } from '@/api/endpoints/movies';
import { useOpenTitle } from '@/context/PersonPageContext';
import { continueCatalogIdOf } from '@/utils/continueItems';
import { baseShowName } from '@/utils/episodeInfo';

/** A Continue Watching card's props: Classic's (ContinueWatching.tsx) and a theme's (registry). */
export interface ContinueCardProps {
  item: MediaItem;
  onClick: (item: MediaItem) => void;
  /** Asks first, then removes. */
  onRemove: () => void;
  /** Removes at once (the title menu has already asked). */
  onRemoveNow: () => void;
  /** Opens the title's page (null: it has none); `opening` while that loads. */
  onDetails: (() => void) | null;
  opening: boolean;
}

/** A progress record's image path as a URL (posters under /api/images, others as given). */
export const continueImageUrl = (path: string | undefined): string | null => {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const base = URL_PATHS.HOST === '/' ? '' : URL_PATHS.HOST;
  return path.startsWith('/api/') ? `${base}${path}` : `${base}/api/images${path}`;
};

function pickBestTitleMatch(results: MediaItem[], query: string, isSeries: boolean): MediaItem | null {
  if (!results.length) return null;
  const want = (isSeries ? baseShowName(query) : query).toLowerCase().trim();
  const exact = results.find((r) => {
    const label = String(r.title || r.name || '').trim();
    const base = (isSeries ? baseShowName(label) : label).toLowerCase().trim();
    return label.toLowerCase() === query.toLowerCase().trim() || base === want;
  });
  if (exact) return exact;
  const starts = results.find((r) => String(r.title || r.name || '').toLowerCase().startsWith(want));
  return starts ?? results[0];
}

/**
 * Details for a Continue Watching item (cards and Home's hero): opens its title's page as the
 * version being watched, no version picker. For legacy progress rows saved without a catalogId,
 * resolves the title via server search on click so the info icon still opens the episode list.
 */
export function useContinueDetails(item: MediaItem | undefined) {
  const openPage = useOpenTitle()?.openPage;
  const [opening, setOpening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyItem = item as any;
  const id = continueCatalogIdOf(item);
  const title = String(anyItem?.cw_show_title || item?.title || item?.name || '').trim();
  const isSeries =
    Number(anyItem?.is_episode) === 1 ||
    Number(anyItem?.is_series) === 1 ||
    anyItem?.cw_content_type === 'series';

  if (!openPage || (!id && !title)) return { openDetails: null, opening };

  return {
    openDetails: () => {
      setOpening(true);
      const run = async () => {
        if (id) {
          const page = {
            id,
            type: id.startsWith('series_') ? 'series' : 'movie',
            title,
            name: title,
            category: '*',
          } as MediaItem;
          await openPage(page);
          return;
        }
        const query = isSeries ? (baseShowName(title) || title) : title;
        const res = isSeries
          ? await getSeries({ category: '*', search: query, page: 1 })
          : await getMedia({ category: '*', search: query, page: 1 });
        const match = pickBestTitleMatch(res.data || [], query, isSeries);
        if (!match?.id) {
          toast.info('Could not find details for this title.');
          return;
        }
        const matchedTitle = String(match.title || match.name || title);
        const matchId = String(match.id);
        const prefix = isSeries ? 'series_' : 'movie_';
        const page = {
          ...match,
          id: matchId.startsWith(prefix) ? matchId : `${prefix}${matchId}`,
          type: isSeries ? 'series' : 'movie',
          title: matchedTitle,
          name: matchedTitle,
          category: match.category_id ? String(match.category_id) : '*',
        } as MediaItem;
        await openPage(page);
      };
      void run().catch(() => {
        toast.info('Could not open details for this title.');
      }).finally(() => setOpening(false));
    },
    opening,
  };
}
