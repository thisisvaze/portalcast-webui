import type { MediaVolumeChange } from '@vidstack/react';

type Levels = Partial<MediaVolumeChange>;

export function initialPlayerVolume(key: string, cast?: Levels, account?: Levels): MediaVolumeChange {
  let saved: Levels | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch { /* Storage is optional. */ }

  const volume = [cast?.volume, saved?.volume, account?.volume].find(
    (v): v is number => typeof v === 'number' && v >= 0 && v <= 1,
  );
  const muted = [cast?.muted, saved?.muted, account?.muted].find(v => typeof v === 'boolean');
  return { volume: volume ?? 1, muted: muted ?? false };
}
