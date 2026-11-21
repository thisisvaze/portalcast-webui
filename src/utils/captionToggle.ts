import { LIVE_CAPTIONS_ID } from './liveCaptions/preference.ts';

export interface CaptionTrackLike {
  id?: string;
  kind?: string;
  label?: string;
  language?: string;
  mode?: string;
}

export interface CaptionToggleInput {
  tracks: readonly CaptionTrackLike[];
  contentType: 'movie' | 'series' | 'tv';
  lastTrackKey: string | null;
  preferredLanguage: string;
  isSearchingBest: boolean;
}

export type CaptionTogglePlan =
  | { action: 'cancel-search' }
  | { action: 'off'; index: number; trackId: string; trackKey: string }
  | { action: 'select'; index: number; trackId: string; trackKey: string }
  | { action: 'best-match' }
  | { action: 'none' };

const ISO3_TO_2: Record<string, string> = {
  eng: 'en', hin: 'hi', tam: 'ta', tel: 'te', mal: 'ml', kan: 'kn',
  ben: 'bn', mar: 'mr', guj: 'gu', pan: 'pa', urd: 'ur', ara: 'ar',
  spa: 'es', por: 'pt', fre: 'fr', fra: 'fr', deu: 'de', ger: 'de',
  ita: 'it', nld: 'nl', dut: 'nl', pol: 'pl', rus: 'ru', tur: 'tr',
  ell: 'el', gre: 'el', heb: 'he', fas: 'fa', per: 'fa', zho: 'zh',
  chi: 'zh', jpn: 'ja', kor: 'ko', tha: 'th', vie: 'vi', ind: 'id',
  msa: 'ms', may: 'ms', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi',
  ron: 'ro', rum: 'ro',
};

const LANGUAGE_NAMES: Record<string, string[]> = {
  en: ['english'],
  hi: ['hindi'],
  ta: ['tamil'],
  te: ['telugu'],
  es: ['spanish', 'espanol', 'español'],
  fr: ['french', 'francais', 'français'],
  de: ['german', 'deutsch'],
  pt: ['portuguese', 'portugues', 'português'],
  it: ['italian', 'italiano'],
  ar: ['arabic'],
  ja: ['japanese'],
  ko: ['korean'],
  zh: ['chinese', 'mandarin'],
};

export function preferredSubtitleLanguage(): string {
  try {
    const lang = (globalThis.navigator?.language || 'en').slice(0, 2).toLowerCase();
    return /^[a-z]{2}$/.test(lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

export function captionTrackKey(track: CaptionTrackLike): string {
  return track.id ? String(track.id) : `${track.kind ?? 'subtitles'}:${track.language ?? ''}:${track.label ?? ''}`;
}

export function isCaptionTrack(track: CaptionTrackLike): boolean {
  return !track.kind || track.kind === 'captions' || track.kind === 'subtitles';
}

export function isUserAddedTrack(track: CaptionTrackLike): boolean {
  const id = String(track.id ?? '');
  return id.startsWith('sub_') || id.startsWith('blob:') || id.startsWith('local_');
}

function normalizeLanguage(code?: string): string {
  const raw = String(code ?? '').trim().toLowerCase();
  if (!raw || raw === 'und') return '';
  const base = raw.split(/[-_]/)[0];
  return ISO3_TO_2[base] ?? (base.length === 2 ? base : '');
}

export function matchesPreferredLanguage(track: CaptionTrackLike, preferred: string): boolean {
  const want = normalizeLanguage(preferred) || 'en';
  const lang = normalizeLanguage(track.language);
  if (lang) return lang === want;
  const label = String(track.label ?? '').toLowerCase();
  const names = LANGUAGE_NAMES[want];
  if (names && names.some(name => label.includes(name))) return true;
  return new RegExp(`(^|[^a-z])${want}([^a-z]|$)`).test(label);
}

/**
 * Decides what pressing C in the web player should do.
 * - While a Best-match fetch is in flight, C cancels it.
 * - While any caption/subtitle track is showing, C turns it off and remembers it.
 * - While captions are off, C restores the remembered track, an already-added online/device
 *   subtitle, or an embedded/external track in the viewer's language; on movies/series with none,
 *   it runs the one-tap Best match online search; on Live TV it falls back to Live auto captions.
 */
export function planCaptionToggle({
  tracks,
  contentType,
  lastTrackKey,
  preferredLanguage,
  isSearchingBest,
}: CaptionToggleInput): CaptionTogglePlan {
  if (isSearchingBest) return { action: 'cancel-search' };

  const captions = tracks
    .map((track, index) => ({ track, index, id: String(track.id ?? ''), key: captionTrackKey(track) }))
    .filter(entry => isCaptionTrack(entry.track));

  const showing = captions.find(entry => entry.track.mode === 'showing');
  if (showing) {
    return { action: 'off', index: showing.index, trackId: showing.id, trackKey: showing.key };
  }

  if (lastTrackKey) {
    const remembered = captions.find(entry => entry.key === lastTrackKey);
    if (remembered) {
      return { action: 'select', index: remembered.index, trackId: remembered.id, trackKey: remembered.key };
    }
  }

  const userAdded = [...captions].reverse().find(entry => isUserAddedTrack(entry.track));
  if (userAdded) {
    return { action: 'select', index: userAdded.index, trackId: userAdded.id, trackKey: userAdded.key };
  }

  const nonLive = captions.filter(entry => entry.id !== LIVE_CAPTIONS_ID);
  const matching = nonLive.find(entry => matchesPreferredLanguage(entry.track, preferredLanguage));
  if (matching) {
    return { action: 'select', index: matching.index, trackId: matching.id, trackKey: matching.key };
  }

  if (contentType !== 'tv') return { action: 'best-match' };

  if (nonLive.length > 0) {
    const first = nonLive[0];
    return { action: 'select', index: first.index, trackId: first.id, trackKey: first.key };
  }

  const live = captions.find(entry => entry.id === LIVE_CAPTIONS_ID);
  if (live) {
    return { action: 'select', index: live.index, trackId: live.id, trackKey: live.key };
  }

  return { action: 'none' };
}
