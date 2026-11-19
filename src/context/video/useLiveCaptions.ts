import { useEffect, useRef, type RefObject } from 'react';
import { TextTrack, type MediaPlayerInstance } from '@vidstack/react';
import { toast } from 'react-toastify';
import { liveCaptionsSupported, startLiveCaptions } from '@/utils/liveCaptions';

const TOAST = 'live-captions';

/**
 * "Live (automatic, English)" in the player's Captions menu: picked, it writes down what is said
 * (utils/liveCaptions) as captions, the last two lines on screen like a broadcast's. Nothing loads
 * until it is picked. Follows the player to the next channel or title (`sourceKey`).
 */
export function useLiveCaptions(playerRef: RefObject<MediaPlayerInstance | null>, sourceKey: string | null | undefined) {
  // Picked on one channel, still on after zapping to the next.
  const wanted = useRef(false);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !sourceKey || !liveCaptionsSupported()) return;

    const track = new TextTrack({ id: 'live-captions', kind: 'captions', label: 'Live (automatic, English)', language: 'en' });
    player.textTracks.add(track);

    let stop: (() => void) | null = null;
    let starting = false;
    let disposed = false;
    // On screen: the last settled line, then the line being said. A line stays until newer speech
    // replaces it, and all go after a quiet spell.
    const settled: VTTCue[] = [];
    let saying: VTTCue | null = null;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const LONG = 3600; // a cue's end: it is removed, never timed out

    const onText = (text: string, final: boolean) => {
      const at = player.currentTime;
      if (saying) track.removeCue(saying as never);
      saying = new VTTCue(at, at + LONG, text);
      track.addCue(saying as never);
      if (final) {
        settled.push(saying);
        saying = null;
      }
      while (settled.length + (saying ? 1 : 0) > 2) track.removeCue(settled.shift() as never);
      clearTimeout(quiet);
      quiet = setTimeout(clear, 7000);
    };

    const clear = () => {
      clearTimeout(quiet);
      for (const cue of settled.splice(0)) track.removeCue(cue as never);
      if (saying) track.removeCue(saying as never);
      saying = null;
    };

    const halt = () => {
      stop?.();
      stop = null;
      clear();
    };

    const start = async () => {
      if (stop || starting) return;
      const media: HTMLMediaElement | null = player.el?.querySelector('video, audio') ?? null;
      if (!media) return;
      starting = true;
      try {
        const stopNow = await startLiveCaptions(media, {
          onText,
          onStatus: (status, device) => {
            if (status === 'loading') {
              toast.info('Live captions: getting the speech model ready (about 150 MB the first time)…', { toastId: TOAST, autoClose: false });
            } else {
              toast.dismiss(TOAST);
              toast.success(`Live captions on (${device === 'webgpu' ? 'GPU' : 'CPU'})`, { autoClose: 2500 });
            }
          },
          onError: () => {
            toast.dismiss(TOAST);
            toast.error("Live captions couldn't start. Try again in a moment.");
            track.setMode('disabled');
          },
        });
        if (disposed || track.mode !== 'showing') stopNow();
        else stop = stopNow;
      } catch (e) {
        const silent = e instanceof Error && (e.message === 'no-audio' || e.name === 'SecurityError');
        toast.error(
          silent
            ? "Live captions can't hear this stream. Turn on the proxy (shield) and pick them again."
            : "Live captions couldn't start in this browser.",
        );
        track.setMode('disabled');
      } finally {
        starting = false;
      }
    };

    const onMode = () => {
      wanted.current = track.mode === 'showing';
      if (wanted.current) void start();
      else halt();
    };
    track.addEventListener('mode-change', onMode);
    if (wanted.current) track.setMode('showing');

    return () => {
      disposed = true;
      track.removeEventListener('mode-change', onMode);
      halt();
      player.textTracks.remove(track);
    };
  }, [playerRef, sourceKey]);
}
