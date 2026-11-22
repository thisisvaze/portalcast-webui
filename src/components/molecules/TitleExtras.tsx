import React from 'react';
import { Check, ChevronRight, Layers, Plus } from 'lucide-react';
import MediaCard from '@/components/molecules/MediaCard';
import ActivityIndicator from '@/components/ui/ActivityIndicator';
import TitleActionButton from '@/components/ui/TitleActionButton';
import {
  getDiscoverBrowse,
  getDiscoverVariants,
  getMyListIds,
  getSimilar,
  setInMyList,
  type DiscoverVariant,
} from '@/api/endpoints/discover';
import { useOpenTitle } from '@/context/PersonPageContext';
import { isContentId } from '@/utils/titleFormat';
import {
  buildMoreLikeThisTiers,
  filterNewUniqueItems,
  inferGenresFromItems,
  parseGenres,
  type MoreLikeThisTier,
} from '@/utils/moreLikeThis';
import type { MediaItem } from '@/types';

/**
 * "Add to My List" / "In My List" next to Play (design-system.md, Detail page). Flips at
 * once and goes back if the server refuses; not shown when the server has no My List.
 */
export const MyListButton: React.FC<{ contentId: string }> = ({
  contentId,
}) => {
  const [inList, setInList] = React.useState<boolean | null>(null);
  const saving = React.useRef(false);
  React.useEffect(() => {
    let cancelled = false;
    setInList(null);
    if (!isContentId(contentId)) return;
    void getMyListIds().then((ids) => {
      if (!cancelled && ids) setInList(ids.has(contentId));
    });
    return () => {
      cancelled = true;
    };
  }, [contentId]);
  if (inList === null) return null;
  const toggle = async () => {
    if (saving.current) return;
    saving.current = true;
    const was = inList;
    setInList(!was);
    try {
      await setInMyList(contentId, !was);
    } catch {
      setInList(was);
    } finally {
      saving.current = false;
    }
  };
  return (
    <TitleActionButton onClick={() => void toggle()} aria-pressed={inList}>
      {inList ? (
        <Check size={18} className="text-accent" />
      ) : (
        <Plus size={18} />
      )}
      <span>{inList ? 'In My List' : 'Add to My List'}</span>
    </TitleActionButton>
  );
};

/**
 * The version open ("Version: Hindi 1080p") under a title's buttons, when it has several: opens
 * the same picker as the first time, so another one can be chosen (its page replaces this one;
 * Back comes back). Nothing for a title with one version.
 */
export const VersionsButton: React.FC<{ contentId: string }> = ({
  contentId,
}) => {
  const openTitle = useOpenTitle();
  const [versions, setVersions] = React.useState<DiscoverVariant[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    setVersions([]);
    if (!isContentId(contentId)) return;
    getDiscoverVariants(contentId)
      .then((v) => {
        if (!cancelled) setVersions(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [contentId]);
  if (!openTitle || versions.length < 2) return null;
  const current = versions.find((v) => String(v.id) === contentId);
  return (
    <TitleActionButton
      onClick={() =>
        openTitle.open({
          ...(current ?? versions[0]),
          id: contentId,
        } as MediaItem)
      }
      title={`${versions.length} versions`}
    >
      <Layers size={18} className="shrink-0" />
      <span className="truncate">
        {current?.variantLabel
          ? `Version: ${current.variantLabel}`
          : `${versions.length} versions`}
      </span>
      <ChevronRight size={16} className="shrink-0 opacity-60" />
    </TitleActionButton>
  );
};

const BROWSE_PAGE_SIZE = 40;
const MAX_EMPTY_BROWSE_STEPS = 4;

/**
 * Vertical poster grid for More Like This with infinite scroll: starts with the server's
 * top /similar matches, then seamlessly pages /discover/browse through narrowing genre tiers.
 */
export const MoreLikeThis: React.FC<{ contentId: string; genres?: string }> = ({
  contentId,
  genres,
}) => {
  const openTitle = useOpenTitle();
  const [items, setItems] = React.useState<MediaItem[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const stateRef = React.useRef<{
    gen: number;
    seen: Set<string>;
    tiers: MoreLikeThisTier[];
    tierIndex: number;
    page: number;
    loading: boolean;
    exhausted: boolean;
    ready: boolean;
  }>({
    gen: 0,
    seen: new Set(),
    tiers: [],
    tierIndex: 0,
    page: 1,
    loading: false,
    exhausted: true,
    ready: false,
  });

  const loadMore = React.useCallback(async () => {
    const s = stateRef.current;
    if (!s.ready || s.loading || s.exhausted) return;
    const gen = s.gen;
    s.loading = true;
    setLoadingMore(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      let steps = 0;
      while (steps < MAX_EMPTY_BROWSE_STEPS && s.tierIndex < s.tiers.length) {
        steps += 1;
        const tier = s.tiers[s.tierIndex];
        const page = s.page;
        const res = await getDiscoverBrowse(
          { ...tier.params, page },
          ac.signal
        );
        if (s.gen !== gen) return;

        const data = res?.data ?? [];
        const total = Number(res?.total_items) || 0;
        const reachedEnd =
          data.length === 0 ||
          (total > 0 && page * BROWSE_PAGE_SIZE >= total) ||
          data.length < BROWSE_PAGE_SIZE;

        if (reachedEnd) {
          s.tierIndex += 1;
          s.page = 1;
        } else {
          s.page = page + 1;
        }

        const fresh = filterNewUniqueItems(data, s.seen);
        if (fresh.length > 0) {
          setItems((prev) => [...prev, ...fresh]);
          break;
        }
      }
    } catch {
      if (s.gen !== gen) return;
      s.exhausted = true;
      setHasMore(false);
    } finally {
      if (s.gen === gen) {
        s.loading = false;
        setLoadingMore(false);
        if (s.tierIndex >= s.tiers.length) {
          s.exhausted = true;
          setHasMore(false);
        }
      }
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    abortRef.current?.abort();
    const s = stateRef.current;
    const gen = s.gen + 1;
    s.gen = gen;
    s.seen = new Set(contentId ? [contentId] : []);
    s.tiers = [];
    s.tierIndex = 0;
    s.page = 1;
    s.loading = false;
    s.exhausted = true;
    s.ready = false;

    setItems([]);
    setHasMore(false);
    setLoadingMore(false);

    if (!isContentId(contentId)) return;
    const mediaType: 'movie' | 'series' = contentId.startsWith('series_')
      ? 'series'
      : 'movie';
    const directGenres = parseGenres(genres);

    void getSimilar(contentId).then((list) => {
      if (cancelled || stateRef.current.gen !== gen) return;
      const fresh = filterNewUniqueItems(list, s.seen);
      const resolvedGenres =
        directGenres.length > 0 ? directGenres : inferGenresFromItems(fresh);
      const tiers = buildMoreLikeThisTiers(mediaType, resolvedGenres);
      s.tiers = tiers;
      s.tierIndex = 0;
      s.page = 1;
      s.ready = true;
      s.exhausted = tiers.length === 0;
      setItems(fresh);
      setHasMore(tiers.length > 0);
      if (fresh.length === 0 && directGenres.length > 0) {
        void loadMore();
      }
    });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [contentId, genres, loadMore]);

  React.useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: '500px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, items.length, loadMore]);

  if (!openTitle || (items.length === 0 && !loadingMore)) return null;
  return (
    <div className="border-line space-y-4 border-t p-4 sm:p-6">
      <h3 className="text-fg text-left text-lg font-bold">More Like This</h3>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        data-focus-group="more-like-this"
      >
        {items.map((item) => (
          <MediaCard
            key={String(item.id)}
            item={item}
            onClick={openTitle.open}
            isLoading={openTitle.loadingItemId === String(item.id)}
          />
        ))}
      </div>
      {hasMore && (
        <div
          ref={sentinelRef}
          className="flex min-h-12 items-center justify-center py-4"
        >
          {loadingMore && (
            <ActivityIndicator className="text-fg-muted text-xl" />
          )}
        </div>
      )}
    </div>
  );
};
