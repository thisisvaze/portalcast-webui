import { useEffect, useRef, type RefObject } from 'react';
import { TextTrack } from '@vidstack/react';
import { toast } from 'react-toastify';
import { liveCaptionsSupported, startLiveCaptions } from '@/utils/liveCaptions';

const TOAST = 'live-captions';

/**
 * "Live (automatic, English)" in the player's Captions menu: picked, it writes down what is said
 * (utils/liveCaptions) as captions, the last two lines on screen like a broadcast's. Nothing loads
 * until it is picked. Follows the player to the next channel or title (`sourceKey`).
 */
export function useLiveCaptions(playerRef: RefObject<any>, sourceKey: string | null | undefined) {
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
    const shown: VTTCue[] = [];

    const onText = (text: string) => {
      const at = player.currentTime as number;
      const words = text.split(/\s+/).length;
      const cue = new VTTCue(at, at + Math.min(8, Math.max(3, words * 0.45)), text);
      track.addCue(cue as never);
      shown.push(cue);
      while (shown.length > 2) track.removeCue(shown.shift() as never);
    };

    const halt = () => {
      stop?.();
      stop = null;
      for (const cue of shown.splice(0)) track.removeCue(cue as never);
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
