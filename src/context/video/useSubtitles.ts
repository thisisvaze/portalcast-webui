/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { getBaseUrl } from '@/api/config';
import { subtitleVtt } from '@/utils/subtitleVtt';
import type { OnlineSubtitleResult } from '@/api/types/subtitles';
import { noteOnlineSubtitle } from '@/utils/subtitleKept';
import { getSubtitleDelay, setSubtitleDelay } from '@/utils/subtitleDelay';
import { probeStreamSubtitles, searchOnlineSubtitles as apiSearchOnlineSubtitles } from '@/api/endpoints/subtitles';
import { downloadSubtitle, subtitleFailureText } from '@/utils/subtitleDownload';
import { preferredSubtitleLanguage } from '@/utils/captionToggle';
import { showCaptionToast } from '@/utils/captionToast';

// Owns subtitle track discovery (embedded-track probing for progressive VOD,
// online search, one-tap Best match, and manual add) — extracted from VideoContext.tsx.
/** What a viewer can change in the subtitle search (Settings › Captions › Add). */
export interface SubtitleQuery {
  title?: string;
  year?: string;
  season?: string;
  episode?: string;
  language?: string;
}

export interface PickOnlineSubtitleOptions {
  query?: SubtitleQuery;
  source?: 'menu' | 'shortcut';
}

export function useSubtitles(
  streamUrl: string | null | undefined,
  rawStreamUrl: string | null | undefined,
  contentType: 'movie' | 'series' | 'tv',
  item: any,
  seriesItem: any,
  itemId?: string | null
) {
  const [subtitles, setSubtitles] = useState<any[]>([]);
  const [onlineSubtitleResults, setOnlineSubtitleResults] = useState<any[]>([]);
  const [subtitleSearchLoading, setSubtitleSearchLoading] = useState(false);
  const [bestSubtitleLoading, setBestSubtitleLoading] = useState(false);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  // The language of the last search (what a kept subtitle is filed under on the server).
  const searchLang = useRef('en');
  const playback = useRef(0);
  const subtitleUrls = useRef(new Map<string, string>());
  const download = useRef<{ controller: AbortController; source: 'menu' | 'shortcut' } | null>(null);

  // Key user-added subtitle lifecycle on the title/file identity rather than the
  // ephemeral stream token so a mid-playback 403 URL refresh keeps downloaded
  // Best match and device .srt tracks intact.
  const titleKey = itemId ?? item?.id ?? streamUrl ?? rawStreamUrl ?? '';

  useEffect(() => {
    const urls = subtitleUrls.current;
    setSubtitles([]);
    setOnlineSubtitleResults([]);
    return () => {
      playback.current++;
      download.current?.controller.abort();
      download.current = null;
      setBestSubtitleLoading(false);
      setPendingTrackId(null);
      urls.forEach(url => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, [titleKey, contentType]);

  useEffect(() => {
    const current = playback.current;
    const isUserTrack = (t: any) =>
      subtitleUrls.current.has(String(t?.id ?? '')) ||
      Array.from(subtitleUrls.current.values()).includes(t?.src);
    setSubtitles(prev => prev.filter(isUserTrack));
    if (!streamUrl || contentType === 'tv') return;

    // Extension-sniffing the URL doesn't work anymore — stream URLs are opaque
    // tokens (`/api/vod/play?t=...`), never a real file extension. Use the
    // same signal the player itself uses to pick HLS vs progressive playback
    // (see VideoPlayerContent.tsx's isM3u8 check): the `&m3u8=1` tag that
    // proxyUrlFor() appends server-side when the underlying resource is HLS.
    // Absence of that tag means progressive — the only case embedded
    // subtitles are even possible to extract from (HLS segments aren't a
    // single seekable file `ffprobe` can inspect for muxed tracks).
    const isProgressive = !(
      (rawStreamUrl && rawStreamUrl.toLowerCase().includes('m3u8')) ||
      streamUrl.toLowerCase().includes('m3u8')
    );

    // A library file (folder or Jellyfin) is asked even when it plays as HLS (the browser
    // fallback): the server knows its tracks and the subtitle files beside it.
    // `lib=1`: a Jellyfin file played straight from Jellyfin (it still carries this server's token).
    const isLibrary = streamUrl.includes('/api/local/') || /[?&]lib=1(&|$)/.test(streamUrl);
    if (!isProgressive && !isLibrary) return;

    const fetchSubtitles = async () => {
      try {
        // The active stream's own token proves identity to the subtitle
        // probe/extract endpoints — they can't require a Bearer header
        // (the <track> element can't attach one), so they reuse whatever
        // token is already minted for this playback session.
        const streamToken = new URL(streamUrl!, window.location.origin).searchParams.get('t');
        if (!streamToken) return;

        const b64url = btoa(rawStreamUrl!);
        const data = await probeStreamSubtitles(rawStreamUrl!, streamToken);
        if (!data || current !== playback.current) return;
        const hostPart = getBaseUrl().replace("/api", "");
        // The file's own subtitle files first (Jellyfin's external subtitles, a folder's
        // .srt; servers from 2026-10-29), then the ones inside the video.
        const external = (Array.isArray(data.external) ? data.external : []).map((sub: any, idx: number) => ({
          src: `${hostPart}${sub.url}`,
          label: sub.label || sub.language || `Subtitle ${idx + 1}`,
          srclang: sub.language || 'und',
          id: `ext_${idx}`,
        }));
        const embedded = (Array.isArray(data.subtitles) ? data.subtitles : []).map((sub: any, idx: number) => ({
          src: `${hostPart}/api/media/subtitle?url=${b64url}&track=${sub.index}&t=${streamToken}`,
          label: sub.title || sub.language || `Track ${idx + 1}`,
          srclang: sub.language || 'und',
          id: sub.index,
        }));
        // A viewer can add a file while the server is still inspecting the movie.
        setSubtitles(added => [...external, ...embedded, ...added]);
      } catch (err) {
        console.error("Failed to fetch subtitles:", err);
      }
    };

    fetchSubtitles();
  }, [streamUrl, rawStreamUrl, contentType]);

  // A language code (older callers), or what the viewer typed in the search form: anything
  // left out is taken from the title playing.
  const searchOnlineSubtitles = useCallback(async (
    query?: string | SubtitleQuery,
    opts?: { useCaptionToast?: boolean; signal?: AbortSignal }
  ): Promise<any[]> => {
    const notify = (type: 'info' | 'error', text: string) => {
      if (opts?.signal?.aborted) return;
      if (opts?.useCaptionToast) showCaptionToast(type, text, 2500);
      else toast[type](text);
    };
    const q: SubtitleQuery = typeof query === 'string' ? { language: query } : (query ?? {});
    const seriesName = seriesItem?.name || seriesItem?.title || '';
    const title = (q.title ?? '').trim() || (item?.is_episode ? (seriesName || item?.title || item?.name || '') : (item?.title || item?.name || ''));
    if (!title) {
      if (opts?.useCaptionToast) notify('info', 'No subtitles found.');
      return [];
    }
    const year = q.year ?? (item?.year ? String(item.year) : '');
    const season = q.season ?? (item?.is_episode && item?.series_number !== undefined ? String(item.series_number) : '');
    const episode = q.episode ?? (item?.is_episode && item?.episode_num !== undefined ? String(item.episode_num) : '');

    setSubtitleSearchLoading(true);
    try {
      const params = new URLSearchParams({ title: title.slice(0, 200) });
      if (/^\d{1,4}$/.test(year)) params.set('year', year);
      if (/^\d{1,4}$/.test(season)) params.set('season', season);
      if (/^\d{1,4}$/.test(episode)) params.set('episode', episode);
      if (q.language) params.set('lang', q.language);
      searchLang.current = q.language || 'en';
      // What is playing: the server hashes the file (exact matches first) and, for a
      // Jellyfin title, also asks Jellyfin's subtitle search.
      const playingToken = streamUrl ? new URL(streamUrl, window.location.origin).searchParams.get('t') : null;
      if (playingToken) params.set('t', playingToken);

      const data = await apiSearchOnlineSubtitles(params);
      if (opts?.signal?.aborted) return [];
      setOnlineSubtitleResults(data?.results || []);
      if (!data?.results?.length) notify('info', 'No subtitles found.');
      return data?.results || [];
    } catch (err) {
      console.error('Subtitle search failed:', err);
      notify('error', 'Subtitle search failed.');
      return [];
    } finally {
      setSubtitleSearchLoading(false);
    }
  }, [item, seriesItem, streamUrl]);

  const addOnlineSubtitle = useCallback((result: OnlineSubtitleResult, vtt: string) => {
    const id = result.downloadId || `os:${result.fileId}`;
    const trackId = `sub_${id}`;
    const src = subtitleUrls.current.get(trackId) ?? URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    subtitleUrls.current.set(trackId, src);
    noteOnlineSubtitle(id, searchLang.current, result.releaseName || null);
    // The timing viewers who kept this one on used, unless this viewer set one for the title.
    if (result.kept && result.keptDelayMs && getSubtitleDelay() === 0) setSubtitleDelay(result.keptDelayMs);
    const track = {
      src,
      label: `${result.language?.toUpperCase() || 'Subtitle'} — ${result.releaseName}`,
      srclang: result.language || 'und',
      id: trackId,
    };
    setSubtitles((prev) => [...prev.filter((t) => t.id !== track.id), track]);
    setOnlineSubtitleResults([]);
    return track.id;
  }, []);

  const clearSubtitleSearch = useCallback(() => {
    setOnlineSubtitleResults([]);
  }, []);

  const addLocalSubtitleFile = useCallback(async (file: File) => {
    const current = playback.current;
    try {
      // FileReader honors UTF-16 byte-order marks as well as UTF-8.
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
      const vtt = await subtitleVtt(content);
      if (current !== playback.current) return;
      const src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      const key = `local_${file.name}`;
      const previous = subtitleUrls.current.get(key);
      subtitleUrls.current.set(key, src);
      if (previous) URL.revokeObjectURL(previous);
      const track = {
        src,
        label: file.name.replace(/\.(srt|vtt)$/i, ''),
        srclang: 'und',
        id: src,
      };
      setSubtitles((prev) => [...prev.filter((t) => t.src !== previous), track]);
      return track.id;
    } catch (err) {
      console.error('Failed to load local subtitle:', err);
      toast.error('Failed to load subtitle file.');
    }
  }, []);

  const cancelOnlineSubtitle = useCallback((onlySource?: 'menu' | 'shortcut') => {
    const active = download.current;
    if (!active) return false;
    if (onlySource && active.source !== onlySource) return false;
    active.controller.abort();
    download.current = null;
    setBestSubtitleLoading(false);
    return true;
  }, []);

  const pickOnlineSubtitle = useCallback(async (
    picked?: OnlineSubtitleResult,
    options?: PickOnlineSubtitleOptions
  ): Promise<string | null> => {
    download.current?.controller.abort();
    const request = new AbortController();
    const source = options?.source ?? 'menu';
    download.current = { controller: request, source };
    setBestSubtitleLoading(!picked);
    if (!picked && source === 'shortcut') {
      showCaptionToast('info', 'Finding subtitles…', 10000);
    }
    try {
      const query = options?.query ?? { language: preferredSubtitleLanguage() };
      const candidates = picked
        ? [picked]
        : (await searchOnlineSubtitles(query, { useCaptionToast: source === 'shortcut', signal: request.signal })).slice(0, 5);
      for (const candidate of candidates) {
        if (request.signal.aborted) return null;
        const vtt = await downloadSubtitle(candidate, request.signal);
        if (request.signal.aborted) return null;
        if (vtt) {
          const trackId = addOnlineSubtitle(candidate, vtt);
          setPendingTrackId(trackId);
          return trackId;
        }
      }
      if (candidates.length && !request.signal.aborted) {
        const message = picked ? subtitleFailureText(picked) : "Couldn't load a subtitle. Try one from the list.";
        if (source === 'shortcut') showCaptionToast('error', message, 3000);
        else toast.error(message);
      }
      return null;
    } finally {
      if (download.current?.controller === request) {
        download.current = null;
        setBestSubtitleLoading(false);
      }
    }
  }, [searchOnlineSubtitles, addOnlineSubtitle]);

  return {
    subtitles,
    onlineSubtitleResults,
    subtitleSearchLoading,
    bestSubtitleLoading,
    pendingTrackId,
    setPendingTrackId,
    searchOnlineSubtitles,
    addOnlineSubtitle,
    addLocalSubtitleFile,
    clearSubtitleSearch,
    pickOnlineSubtitle,
    cancelOnlineSubtitle,
  };
}
