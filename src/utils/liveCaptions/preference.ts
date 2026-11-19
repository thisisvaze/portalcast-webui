export const LIVE_CAPTIONS_ID = 'live-captions';
export type CaptionEngine = 'nemotron' | 'moonshine';
export const captionEngineKey = 'portalcast:captionEngine';

export function savedCaptionEngine(): CaptionEngine {
  try {
    const engine = localStorage.getItem(captionEngineKey);
    if (engine === 'moonshine') return engine;
  } catch { /* storage unavailable */ }
  return 'nemotron';
}

function knownLanguage(value?: string | null): string | undefined {
  const lang = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return lang && !['und', 'unknown', 'undefined', 'mul', 'zxx'].includes(lang) ? lang : undefined;
}
const english = /^(?:en|eng|english)(?:$|[\s(_-])/i;
const namedLanguage = /^(English|Hindi|Spanish|French|German|Arabic|Tamil|Telugu|Malayalam|Kannada|Bengali|Marathi|Gujarati|Punjabi|Urdu|Portuguese|Italian|Japanese|Korean|Chinese|Russian|Dutch|Polish|Turkish)\b/i;

interface AudioInfo {
  name?: string;
  audio_tracks?: { language?: string }[];
  audio_language?: string;
  language?: string;
  version_label?: string;
}

/** Catalogue hints for streams with no tagged audio track. A subtitle or a second available
 * language doesn't tell us which language is being spoken. */
export function catalogueEnglish(item?: AudioInfo | null, group?: string, channelName?: string): boolean | undefined {
  const language = knownLanguage(item?.audio_language) ??
    (item?.audio_tracks?.length === 1 ? knownLanguage(item.audio_tracks[0].language) : undefined) ??
    knownLanguage(item?.language);
  if (language) return english.test(language);
  // Provider names like "Star Sports 2 Tamil 4K" identify a feed more precisely than "Cricket".
  const feed = channelName?.replace(/(?:[\s|_-]+(?:HD|FHD|UHD|4K|SD|\d{3,4}p))+$/i, '').trim().split(/[\s|_-]+/).pop();
  if (feed && namedLanguage.test(feed)) return english.test(feed);
  const groupLang = group?.split(/[|:·/]/).map(s => s.trim().match(namedLanguage)?.[1]).find(Boolean);
  if (groupLang) return english.test(groupLang);
  const version = item?.version_label?.replace(/^local\s*·\s*/i, '') ?? '';
  const lang = version?.match(namedLanguage)?.[1];
  return lang && /^(?:$|\s+(?:\(\+|4K\b|UHD\b|HD\b|\d{3,4}p\b))/i.test(version.slice(lang.length)) ? english.test(lang) : undefined;
}

export function playingEnglish(track: { language: string; label: string } | null, fallback: boolean | undefined): boolean {
  const language = knownLanguage(track?.language);
  if (language) return english.test(language);
  const label = track?.label.trim();
  if (label && (english.test(label) || namedLanguage.test(label))) return english.test(label);
  // Many live channels and MP4 files have no language metadata. Honor the opt-in unless
  // the selected audio or catalogue actually identifies a different language.
  return fallback !== false;
}
