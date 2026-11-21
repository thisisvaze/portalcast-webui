import type { MediaItem } from '@/types';

/**
 * Episode numbers, titles and air dates that hold up on real portals — the same rules as
 * the TV app's EpisodeInfo.kt, so both clients show an episode the same way.
 *
 * Stalker portals put the number only in the name ("Episode 13. Friends and Family"),
 * daily soaps put the air date there too ("2026-05-26 - Kamini Secretly…",
 * "Episode 1294. 25-07-2026 : Ep. 1294 - A Tough Time For Pushpa"), and some episodes
 * are named after the show itself ("2026-05-30 - Kamali") or the show and season
 * ("Episode 1. The Big Bang Theory: Season 1").
 */

const SXXEYY = /\bS\d{1,2}\s*E(\d{1,4})\b/i;
const LEADING_EPISODE = /^\s*(?:episode|ep\.?|e)\s*(\d{1,4})\s*(?:[.:\-–—)]\s*)?/i;
const LEADING_NUMBER = /^\s*(\d{1,4})\s*[.:\-–—)]\s+/;
const ISO_DATE = /^\s*((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\s*(?:[.:\-–—|]\s*)?/;
const DMY_DATE = /^\s*(\d{1,2})[-./](\d{1,2})[-./]((?:19|20)\d{2})\s*(?:[.:\-–—|]\s*)?/;
const SEASON_ONLY = /^(?:season|s)\s*:?\s*\d{1,3}(?:\s*(?:[-–—]|to)\s*(?:\d{1,3}|current))?$/i;
const SHOW_AND_SEASON = /^.+?\s*[:\-–—|]\s*(?:season|s)\s*:?\s*\d{1,3}(?:\s*(?:[-–—]|to)\s*(?:\d{1,3}|current))?$/i;
const TRAILING_SERIES_SUFFIX = /\s*(?:[:\-–—|]\s*(?:season|s)\s*:?\s*\d{1,3}(?:\s*(?:[-–—]|to)\s*(?:\d{1,3}|current))?|\(\s*(?:(?:19|20)\d{2}|[A-Z]{2,3})\s*\)|\[[^\]]+\])\s*$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// "October 19, 2026" / "19 October 2026"
const MDY_WORDS = new RegExp(`^\\s*${MONTH_WORD}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})\\s*(?:[.:\\-–—|]\\s*)?`, 'i');
const DMY_WORDS = new RegExp(`^\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}\\.?,?\\s+((?:19|20)\\d{2})\\s*(?:[.:\\-–—|]\\s*)?`, 'i');
const monthIndex = (word: string) => MONTHS.findIndex((m) => word.toLowerCase().startsWith(m.toLowerCase()));

/** "The Big Bang Theory: Season 1 - 12 (2007)" -> "The Big Bang Theory". */
export function baseShowName(seriesTitle?: string): string {
  let cur = (seriesTitle ?? '').trim();
  while (cur) {
    const next = cur.replace(TRAILING_SERIES_SUFFIX, '').trim();
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** "Kamali - October 19, 2026" -> "October 19, 2026": a show-name prefix says nothing. */
function withoutShowName(name: string, seriesTitle?: string): string {
  const candidates = [seriesTitle?.trim(), baseShowName(seriesTitle)].filter((s): s is string => Boolean(s));
  const lower = name.toLowerCase();
  for (const show of candidates) {
    if (!lower.startsWith(show.toLowerCase())) continue;
    const rest = name.slice(show.length);
    if (/^\s*[-–—:|]/.test(rest)) return rest.replace(/^\s*[-–—:|]\s*/, '');
  }
  return name;
}

function afterNumber(name: string): string {
  return name.replace(SXXEYY, ' ').replace(LEADING_EPISODE, '').replace(LEADING_NUMBER, '').trim();
}

function cleanCandidateTitle(raw: string, seriesTitle?: string): string {
  let rest = withoutShowName(afterNumber(raw), seriesTitle);
  rest = rest.replace(ISO_DATE, '').replace(DMY_DATE, '').replace(MDY_WORDS, '').replace(DMY_WORDS, '');
  rest = rest.replace(LEADING_EPISODE, '').replace(LEADING_NUMBER, '');
  const stripped = rest.replace(/\s+/g, ' ').trim().replace(/^[-–—:.|\s]+/, '');
  const showLower = seriesTitle?.trim().toLowerCase() || '';
  const baseLower = baseShowName(seriesTitle).toLowerCase();
  const low = stripped.toLowerCase();
  const isShowName = (Boolean(showLower) && low === showLower) || (Boolean(baseLower) && low === baseLower);
  const isSeasonOnly = SEASON_ONLY.test(stripped);
  const isShowAndSeason = SHOW_AND_SEASON.test(stripped);
  return !stripped || isShowName || isSeasonOnly || isShowAndSeason ? '' : stripped;
}

function rawName(ep: MediaItem): string {
  const title = String(ep.title || '').trim();
  const name = String(ep.name || '').trim();
  if (title && name && title !== name && !cleanCandidateTitle(title) && cleanCandidateTitle(name)) {
    return name;
  }
  return title || name;
}

/** The number an episode carries: from its name, then episode_num; null when it has none. */
function ownNumber(ep: MediaItem): number | null {
  const name = rawName(ep);
  for (const re of [SXXEYY, LEADING_EPISODE, LEADING_NUMBER]) {
    const m = re.exec(name);
    if (m) return Number(m[1]);
  }
  const n = Number(ep.episode_num);
  return n > 0 ? n : null;
}

/** The episode's number: from its name, then episode_num, then its position (1-based). */
export function episodeNumber(ep: MediaItem, fallbackIndex: number): number {
  return ownNumber(ep) ?? fallbackIndex + 1;
}

/**
 * A whole season in episode order (1, 2, 3...), whichever way the provider listed it (most
 * newest first, some oldest first). As listed when an episode has no number of its own.
 */
export function inEpisodeOrder<T extends MediaItem>(eps: T[]): T[] {
  const nums = eps.map(ownNumber);
  if (nums.some((n) => n === null)) return eps;
  return eps
    .map((ep, i) => ({ ep, n: nums[i] as number }))
    .sort((a, b) => a.n - b.n)
    .map((x) => x.ep);
}

/** "26 May 2026" when the name starts with an air date (after any episode prefix). */
export function episodeAirDate(ep: MediaItem, seriesTitle?: string): string | null {
  const rest = withoutShowName(afterNumber(rawName(ep)), seriesTitle);
  const words = MDY_WORDS.exec(rest);
  if (words) return `${Number(words[2])} ${MONTHS[monthIndex(words[1])]} ${words[3]}`;
  const wordsDmy = DMY_WORDS.exec(rest);
  if (wordsDmy) return `${Number(wordsDmy[1])} ${MONTHS[monthIndex(wordsDmy[2])]} ${wordsDmy[3]}`;
  let day: number, month: number, year: string;
  const iso = ISO_DATE.exec(rest);
  const dmy = iso ? null : DMY_DATE.exec(rest);
  if (iso) { year = iso[1]; month = Number(iso[2]); day = Number(iso[3]); }
  else if (dmy) { day = Number(dmy[1]); month = Number(dmy[2]); year = dmy[3]; }
  else return null;
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${day} ${MONTHS[month - 1]} ${year}` : null;
}

/**
 * The title without its number prefix and leading air date; "Episode N" when nothing
 * meaningful is left, including a name that is only the show's own name or a season.
 */
export function episodeTitle(ep: MediaItem, fallbackIndex: number, seriesTitle?: string): string {
  const title = String(ep.title || '').trim();
  const name = String(ep.name || '').trim();
  // Prefer a real name when the server enriched `name` from TMDB while `title` stayed placeholder.
  const cleaned =
    cleanCandidateTitle(title, seriesTitle) ||
    (name && name !== title ? cleanCandidateTitle(name, seriesTitle) : '');
  return cleaned || `Episode ${episodeNumber(ep, fallbackIndex)}`;
}

/** "21m", "1h 5m" from minutes or seconds-ish values; null when unknown. */
export function episodeRuntime(ep: MediaItem): string | null {
  return runtimeText(Number((ep as { time?: unknown }).time ?? 0) || Number(ep.duration ?? 0));
}

/** "21m", "2h 5m" from minutes (or seconds, when implausibly long for minutes); null when unknown. */
export function runtimeText(raw: number): string | null {
  if (!raw || raw <= 0) return null;
  const minutes = raw > 600 ? Math.round(raw / 60) : raw; // seconds when implausibly long for minutes
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
