import { useState } from 'react';
import type { MediaVolumeChange, MediaVolumeChangeEvent } from '@vidstack/react';
import { useAuth } from '@/context/AuthContext';
import { initialPlayerVolume } from '@/utils/playerVolume';

export function usePlayerVolume(playback?: Partial<MediaVolumeChange>) {
  const { user } = useAuth();
  const key = `portalcast:volume:${user?.id ?? 'guest'}`;
  const cast = playback?.volume !== undefined || playback?.muted !== undefined ? playback : undefined;

  const initial = () => ({ key, cast, ...initialPlayerVolume(key, cast, user?.preferences) });
  const [audio, setAudio] = useState(initial);
  if (audio.key !== key || audio.cast !== cast) setAudio(initial());

  function onVolumeChange(level: MediaVolumeChange, event: MediaVolumeChangeEvent) {
    // Provider startup also emits volume changes. Only a volume or mute control sets the preference.
    if (!event.request) return;
    setAudio({ key, cast, ...level });
    try { localStorage.setItem(key, JSON.stringify(level)); } catch { /* keep the session choice */ }
  }

  return { volume: audio.volume, muted: audio.muted, onVolumeChange };
}
