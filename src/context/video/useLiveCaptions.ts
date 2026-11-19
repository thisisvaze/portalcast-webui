import { useEffect, useRef, useState, type RefObject } from 'react';
import { TextTrack, type MediaPlayerInstance } from '@vidstack/react';
import { toast } from 'react-toastify';
import { liveCaptionsSupported, startLiveCaptions } from '@/utils/liveCaptions';
import { captionLines } from '@/utils/liveCaptions/lines';
import { LIVE_CAPTIONS_ID, playingEnglish } from '@/utils/liveCaptions/preference';

/**
 * "Live (automatic, English)" in the player's Captions menu: picked, it writes down what is said
 * (utils/liveCaptions). Returns the lines to show (null: none), drawn by the player itself: two
 * lines of at most 42 characters, words added as they are said, a full line moving up whole.
 * The track only stands for the menu entry: cues through it were not removed reliably (the
 * player mirrors tracks into the browser's, which threw on removal, so old lines piled up).
 * Nothing loads until it is picked. Follows the player to the next channel or title (`sourceKey`).
 */
export function useLiveCaptions(playerRef: RefObject<MediaPlayerInstance | null>, sourceKey: string | null | undefined, englishAudio: boolean | undefined, autoCaptions: boolean): string[] | null {
  const [lines, setLines] = useState<string[] | null>(null);
  const wanted = useRef(autoCaptions);
  const syncChoice = useRef<((enabled: boolean) => void) | null>(null);
  useEffect(() => {
    wanted.current = autoCaptions;
    syncChoice.current?.(autoCaptions);
  }, [autoCaptions]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !sourceKey || !liveCaptionsSupported()) return;

    const track = new TextTrack({ id: LIVE_CAPTIONS_ID, kind: 'captions', label: 'Live (automatic, English)', language: 'en' });
    player.textTracks.add(track);

    let stop: (() => void) | null = null;
    let pending: AbortController | null = null;
    let running = false;
    let generation = 0;
    let failed = false;
    // What has been said (settled, its last two lines) and the piece being said.
    let said = '';
    let saying = '';
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const show = () => setLines(captionLines(`${said} ${saying}`.trim()));

    const onText = (text: string, final: boolean) => {
      if (final) {
        said = captionLines(`${said} ${text}`.trim()).join(' '); // its last two lines: those stay as they are
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
      generation++;
      running = false;
      pending?.abort();
      pending = null;
      stop?.();
      stop = null;
      clear();
    };

    const start = async () => {
      if (running || !player.state.canPlay) return;
      const media: HTMLMediaElement | null = player.el?.querySelector('video, audio') ?? null;
      if (!media || media.paused || media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      running = true;
      pending = new AbortController();
      const id = ++generation;
      const fail = (message: string) => {
        if (id !== generation) return;
        failed = true;
        toast.error(message);
        track.setMode('disabled');
      };
      try {
        const stopNow = await startLiveCaptions(media, {
          onText: (text, final) => { if (id === generation) onText(text, final); },
          onError: () => fail("Live captions couldn't start. Try again in a moment."),
        }, pending.signal);
        if (id !== generation) stopNow();
        else stop = stopNow;
      } catch (e) {
        const silent = e instanceof Error && (e.message === 'no-audio' || e.name === 'SecurityError');
        fail(
          silent
            ? "Live captions can't hear this stream. Turn on the proxy (shield) and pick them again."
            : "Live captions couldn't start in this browser.",
        );
      }
    };

    const onMode = () => {
      if (track.mode === 'showing') {
        failed = false;
        void start();
      } else halt();
    };
    const isEnglish = () => playingEnglish(player.audioTracks.selected, englishAudio);
    const restore = () => {
      if (track.mode === 'showing') void start(); // also supports manually selected, untagged streams
      else if (!failed && player.state.canPlay && wanted.current && isEnglish()) track.setMode('showing');
    };
    const audioChanged = () => {
      if (!isEnglish()) track.setMode('disabled');
      else restore();
    };
    track.addEventListener('mode-change', onMode);
    player.addEventListener('can-play', restore);
    player.addEventListener('playing', restore);
    player.audioTracks.addEventListener('change', audioChanged);
    syncChoice.current = (enabled) => {
      if (enabled) restore();
      else track.setMode('disabled');
    };
    restore();

    return () => {
      syncChoice.current = null;
      player.removeEventListener('can-play', restore);
      player.removeEventListener('playing', restore);
      player.audioTracks.removeEventListener('change', audioChanged);
      track.removeEventListener('mode-change', onMode);
      halt();
      player.textTracks.remove(track);
    };
  }, [playerRef, sourceKey, englishAudio]);

  return lines;
}
