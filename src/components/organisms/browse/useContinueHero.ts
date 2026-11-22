/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import type { ProgressRecord } from '@/api/types/user';
import { URL_PATHS } from '@/api/config';
import {
  getDiscoverVariants,
  getTitleDetails,
  type TitleDetails,
} from '@/api/endpoints/discover';
import {
  continueCatalogIdOf,
  continueItemsOf,
  pickVariantBackdrop,
} from '@/utils/continueItems';
import { isContentId } from '@/utils/titleFormat';
import { useContinueDetails } from './continueCard';

const urlOf = (path: string | undefined): string | null => {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const base = URL_PATHS.HOST === '/' ? '' : URL_PATHS.HOST;
  return path.startsWith('/api/')
    ? `${base}${path}`
    : `${base}/api/images${path}`;
};

/** The title last watched, with its details and art, for a theme's hero. Null: nothing to resume. */
export function useContinueHero(progressRecords: ProgressRecord[]) {
  const item = React.useMemo(
    () => continueItemsOf(progressRecords)[0],
    [progressRecords]
  );
  const anyItem = item as any;
  const catalogId: string = continueCatalogIdOf(item) ?? '';
  const primaryBackdrop =
    typeof anyItem?.cw_backdrop === 'string' && anyItem.cw_backdrop
      ? (anyItem.cw_backdrop as string)
      : undefined;
  const [details, setDetails] = React.useState<TitleDetails | null>(null);
  const [primaryFailed, setPrimaryFailed] = React.useState(false);
  const [fallbackBackdrop, setFallbackBackdrop] = React.useState<string | null>(
    null
  );
  const [fallbackFailed, setFallbackFailed] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    setDetails(null);
    if (!isContentId(catalogId)) return;
    void getTitleDetails({ id: catalogId }).then((d) => {
      if (!cancelled) setDetails(d);
    });
    return () => {
      cancelled = true;
    };
  }, [catalogId]);
  React.useEffect(() => {
    setPrimaryFailed(false);
    setFallbackBackdrop(null);
    setFallbackFailed(false);
  }, [primaryBackdrop, catalogId]);
  const needsFallback =
    isContentId(catalogId) && (!primaryBackdrop || primaryFailed);
  React.useEffect(() => {
    if (!needsFallback) return;
    const ac = new AbortController();
    let cancelled = false;
    void getDiscoverVariants(catalogId, ac.signal)
      .then((variants) => {
        if (cancelled) return;
        const picked = pickVariantBackdrop(
          variants,
          primaryFailed ? primaryBackdrop : null
        );
        setFallbackBackdrop(picked);
        setFallbackFailed(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [needsFallback, catalogId, primaryFailed, primaryBackdrop]);
  const { openDetails, opening } = useContinueDetails(item);
  if (!item) return null;
  const title = (anyItem.cw_show_title ||
    item.title ||
    item.name ||
    '') as string;
  const activeBackdrop =
    primaryBackdrop && !primaryFailed
      ? primaryBackdrop
      : fallbackBackdrop && !fallbackFailed
        ? fallbackBackdrop
        : undefined;

  return {
    item,
    details,
    title,
    openDetails,
    detailsLoading: opening,
    art: urlOf(activeBackdrop),
    onArtError: () => {
      if (primaryBackdrop && !primaryFailed) setPrimaryFailed(true);
      else setFallbackFailed(true);
    },
    detail: anyItem.cw_detail as string | undefined,
    pct: Math.min(100, Math.max(0, Number(item.progressPercent) || 0)),
  };
}
