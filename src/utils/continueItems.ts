/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MediaItem } from '@/types';
import type { ProgressRecord } from '@/api/types/user';
import { isContentId, timeLeft } from './titleFormat.ts';
import { baseShowName } from './episodeInfo.ts';

export interface ProgressEntry {
  id?: string;
  mediaId: string;
  itemId?: string;
  type: string;
  title: string;
  name?: string;
  episodeTitle?: string;
  screenshot_uri?: string;
  is_series?: number;
  cmd?: string;
  series_number?: number;
  catalogId?: string;
  currentTime: number;
  duration: number;
  progressPercent: number;
  timestamp: number;
}

const BARE_ID = /^[\w.-]{1,120}$/;

export function normalizeCatalogId(raw: unknown, isSeries: boolean): string | undefined {
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  if (!s) return undefined;
  if (isContentId(s)) return s;
  if (BARE_ID.test(s)) return `${isSeries ? 'series' : 'movie'}_${s}`;
  return undefined;
}

function titleGroupKey(title: unknown, isSeries: boolean): string | null {
  const raw = typeof title === 'string' ? title.trim() : '';
  if (!raw) return null;
  const base = (isSeries ? baseShowName(raw) : raw).toLowerCase().replace(/\s+/g, ' ').trim();
  return base ? `${isSeries ? 'series' : 'movie'}:${base}` : null;
}

function cleanContinueEpisodeLabel(episodeTitle: string | undefined, showTitle: string | undefined): string | undefined {
  const raw = (episodeTitle || '').trim();
  if (!raw) return undefined;
  const show = (showTitle || '').trim();
  const base = baseShowName(show);
  // Strip repeated show-name prefix ("Young Sheldon – Young Sheldon: Season 1" -> "Season 1").
  let cur = raw;
  for (let i = 0; i < 2; i++) {
    const low = cur.toLowerCase();
    let changed = false;
    for (const prefix of [show, base].filter(Boolean)) {
      if (low.startsWith(prefix.toLowerCase())) {
        const rest = cur.slice(prefix.length);
        if (/^\s*[-–—:|]/.test(rest)) {
          cur = rest.replace(/^\s*[-–—:|]\s*/, '').trim();
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }
  return cur || raw;
}

/**
 * Resolves the catalogId ("series_123" / "movie_456") for a Continue Watching item when
 * directly known, normalizing bare ids and falling back to movie_<id> for movies.
 */
export function continueCatalogIdOf(item: MediaItem | undefined): string | null {
  if (!item) return null;
  const anyItem = item as any;
  const isSeries =
    Number(anyItem.is_episode) === 1 ||
    Number(anyItem.is_series) === 1 ||
    anyItem.cw_content_type === 'series';
  const direct = normalizeCatalogId(anyItem.catalogId, isSeries);
  if (direct) return direct;
  if (!isSeries) {
    return normalizeCatalogId(item.id, false) ?? null;
  }
  return null;
}

/**
 * Continue Watching cards from the viewer's progress records, newest first: unfinished,
 * not live TV, one card per title. Shared by the row and the Home hero.
 */
export function continueItemsOf(progressRecords: ProgressRecord[]): MediaItem[] {
  const items: MediaItem[] = [];
  const addedIds = new Set<string>();
  const addedShows = new Set<string>();

  // Pass 1: collect known catalogIds and backdrops across all rows (including completed
  // ones) so an older/next-episode row missing catalogId still inherits its show's page
  // and backdrop instead of losing the Details/(i) button.
  const catalogByTitle = new Map<string, string>();
  const backdropByCatalog = new Map<string, string>();
  const backdropByTitle = new Map<string, string>();
  const byNewest = [...progressRecords].sort(
    (a, b) => (b.meta?.timestamp || 0) - (a.meta?.timestamp || 0)
  );
  for (const record of byNewest) {
    const entry = record.meta as ProgressEntry | undefined;
    if (!entry || entry.type === 'tv') continue;
    const isSeries = (entry.is_series ?? 0) === 1 || entry.type === 'series';
    const tKey = titleGroupKey(entry.title || entry.name, isSeries);
    const cat = normalizeCatalogId(entry.catalogId, isSeries);
    const backdrop = typeof (record as any).backdrop_path === 'string' && (record as any).backdrop_path
      ? String((record as any).backdrop_path)
      : undefined;
    if (cat && tKey && !catalogByTitle.has(tKey)) catalogByTitle.set(tKey, cat);
    if (backdrop && cat && !backdropByCatalog.has(cat)) backdropByCatalog.set(cat, backdrop);
    if (backdrop && tKey && !backdropByTitle.has(tKey)) backdropByTitle.set(tKey, backdrop);
  }

  const sortedRecords = progressRecords
    .filter((record) => !record.completed && record.meta && record.meta.type !== 'tv')
    .sort((a, b) => {
      const timeA = a.meta.timestamp || 0;
      const timeB = b.meta.timestamp || 0;
      return timeB - timeA;
    });

  const completedMediaIds = new Set(
    progressRecords.filter((r) => r.completed).map((r) => r.mediaId)
  );

  for (const record of sortedRecords) {
    try {
      const entry = record.meta as ProgressEntry;
      const displayId = entry.id || entry.itemId || entry.mediaId || record.mediaId;

      if (!displayId || addedIds.has(displayId.toString())) continue;
      if (completedMediaIds.has(displayId.toString())) continue;

      const isSeries = (entry.is_series ?? 0) === 1 || entry.type === 'series';
      const tKey = titleGroupKey(entry.title || entry.name, isSeries);
      const playbackFileId = (entry as any).playbackFileId || entry.itemId || entry.mediaId;

      // Resolve a valid prefixed catalogId: direct (normalized) -> inherited from a
      // sibling row of the same title -> distinct series mediaId (ignoring legacy
      // next-episode rows where mediaId was overwritten with playbackFileId) -> movie id.
      let resolvedCatalogId =
        normalizeCatalogId(entry.catalogId, isSeries) ||
        (tKey ? catalogByTitle.get(tKey) : undefined);
      if (!resolvedCatalogId && isSeries) {
        const seriesMediaId = entry.mediaId ? String(entry.mediaId) : '';
        const distinctFromEpisode =
          seriesMediaId &&
          seriesMediaId !== String(playbackFileId ?? '') &&
          seriesMediaId !== String(entry.itemId ?? '');
        if (distinctFromEpisode) {
          resolvedCatalogId = normalizeCatalogId(seriesMediaId, true);
        }
      } else if (!resolvedCatalogId && !isSeries) {
        resolvedCatalogId = normalizeCatalogId(entry.mediaId || displayId, false);
      }

      // One card per show/title: multiple episodes of the same series collapse to the newest.
      const showKey = resolvedCatalogId || (isSeries ? tKey : null);
      if (showKey && addedShows.has(showKey)) continue;

      const seriesIdFromCatalog = resolvedCatalogId?.startsWith('series_')
        ? resolvedCatalogId.slice('series_'.length)
        : undefined;

      const backdrop =
        (record as any).backdrop_path ||
        (resolvedCatalogId ? backdropByCatalog.get(resolvedCatalogId) : undefined) ||
        (tKey ? backdropByTitle.get(tKey) : undefined) ||
        undefined;

      const episodeDetail = isSeries
        ? cleanContinueEpisodeLabel(entry.episodeTitle, entry.title)
        : undefined;

      items.push({
        id: displayId.toString(),
        series_id: isSeries ? (seriesIdFromCatalog || entry.mediaId) : undefined,
        season_id: isSeries ? (entry as any).seasonId || undefined : undefined,

        title: isSeries
          ? `${entry.title}${entry.episodeTitle ? ' – ' + entry.episodeTitle : ''}`
          : entry.title,
        name: isSeries
          ? `${entry.name || entry.title}${entry.episodeTitle ? ' – ' + entry.episodeTitle : ''}`
          : entry.name || entry.title,
        series_name: isSeries ? entry.title : undefined,
        series_name_alt: isSeries ? (entry.name || entry.title) : undefined,

        screenshot_uri: entry.screenshot_uri,

        is_series: 0,
        is_season: 0,
        is_episode: isSeries ? 1 : 0,
        is_playable_movie: !isSeries,
        is_continue_watching: true,
        resumeTime: Number(record.progress) || Number(entry.currentTime) || 0,
        cmd: entry.cmd,
        series_number: entry.series_number,
        progressPercent: entry.progressPercent,
        catalogId: resolvedCatalogId,

        playbackFileId,

        cw_content_type: entry.type,
        cw_category_id: (entry as any).categoryId || null,

        cw_episode_card_id: (entry as any).episodeCardId || entry.itemId || null,

        cw_backdrop: backdrop,
        cw_show_title: entry.title,
        cw_detail: [episodeDetail, timeLeft(entry.duration - entry.currentTime)]
          .filter(Boolean).join(' · ') || undefined,
      } as any);
      addedIds.add(displayId.toString());
      if (showKey) addedShows.add(showKey);
    } catch (err) {
      console.error(`Failed to parse CW entry for record`, record, err);
    }
  }
  return items;
}
