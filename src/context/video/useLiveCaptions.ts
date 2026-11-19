import { useEffect, useRef, useState, type RefObject } from 'react';
import { TextTrack, type MediaPlayerInstance } from '@vidstack/react';
import { toast } from 'react-toastify';
import { liveCaptionsSupported, startLiveCaptions } from '@/utils/liveCaptions';
import { captionLines } from '@/utils/liveCaptions/lines';

const TOAST = 'live-captions';

/**
 * "Live (automatic, English)" in the player's Captions menu: picked, it writes down what is said
 * (utils/liveCaptions). Returns the lines to show (null: none), drawn by the player itself: two
 * lines of at most 42 characters, words added as they are said, older ones rolling off the top.
 * The track only stands for the menu entry: cues through it were not removed reliably (the
 * player mirrors tracks into the browser's, which threw on removal, so old lines piled up).
 * Nothing loads until it is picked. Follows the player to the next channel or title (`sourceKey`).
 */
export function useLiveCaptions(playerRef: RefObject<MediaPlayerInstance | null>, sourceKey: string | null | undefined): string[] | null {
  // Picked on one channel, still on after zapping to the next.
  const wanted = useRef(false);
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !sourceKey || !liveCaptionsSupported()) return;

    const track = new TextTrack({ id: 'live-captions', kind: 'captions', label: 'Live (automatic, English)', language: 'en' });
    player.textTracks.add(track);

    let stop: (() => void) | null = null;
    let starting = false;
    let disposed = false;
    // What has been said (settled, the last few hundred characters) and the line being said.
    let said = '';
    let saying = '';
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const show = () => setLines(captionLines(`${said} ${saying}`.trim()));

    const onText = (text: string, final: boolean) => {
      if (final) {
        said = `${said} ${text}`.trim().slice(-300);
        saying = '';
      } else {
        saying = text;
      }
      show();
      clearTimeout(quiet);
      quiet = setTimeout(clear, 7000);
    };

    const clear = () => {
      clearTimeout(quiet);
      said = '';
      saying = '';
      setLines(null);
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
          onStatus: (status, device, model, size) => {
            if (status === 'loading') {
              toast.info(`Live captions: getting ${model} ready (${size ?? 'a download'} the first time)…`, { toastId: TOAST, autoClose: false });
            } else {
              toast.dismiss(TOAST);
              toast.success(`Live captions on: ${model}, ${device === 'webgpu' ? 'GPU' : 'CPU'}`, { autoClose: 2500 });
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

  return lines;
}
