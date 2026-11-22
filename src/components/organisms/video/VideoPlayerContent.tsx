/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyDialogueBoost } from '@/utils/dialogueBoost';
import {
  MediaPlayer,
  MediaProvider,
  Captions,
  useMediaRemote,
  type PlayerSrc,
} from '@vidstack/react';
import '@vidstack/react/player/styles/base.css';

import TvChannelList, {
  type TvChannelListRef,
} from '@/components/organisms/channels/TvChannelList';
import EpisodeOverlay, {
  type EpisodeOverlayRef,
} from '@/components/organisms/video/EpisodeOverlay';
import '@/components/organisms/video/VideoPlayerContent.css';

import { BufferingOverlay } from '@/components/molecules/BufferingOverlay';
import ActivityIndicator from '@/components/ui/ActivityIndicator';
import { SeekOverlay } from '@/components/molecules/SeekOverlay';
import { TopBar } from '@/components/organisms/layout/TopBar';
import { TVControls } from '@/components/organisms/video/TVControls';
import { VODControls } from '@/components/organisms/video/VODControls';
import { useVideoContext } from '@/context/video';
import { PlayPauseFlash } from '@/components/molecules/PlayPauseFlash';
import { useVideoQuality } from '@/hooks/useVideoQuality';
import { bindSubtitleDelay, applySubtitleDelay, getSubtitleDelay } from '@/utils/subtitleDelay';
import { createKeptTracker, onlineSubtitleKey } from '@/utils/subtitleKept';
import { useTVRemoteNavigation } from '@/components/organisms/video/hooks/useTVRemoteNavigation';
import { useTouchGestures } from '@/components/organisms/video/hooks/useTouchGestures';
import { usePlayerVolume } from '@/context/video/usePlayerVolume';
import { useLiveCaptions } from '@/context/video/useLiveCaptions';
import { catalogueEnglish } from '@/utils/liveCaptions/preference';
import { getUserProgress } from '@/api/endpoints/user';
import { playbackPositionStorage } from '@/utils/playbackPosition';
import { captionTrackKey, isUserAddedTrack, planCaptionToggle, preferredSubtitleLanguage } from '@/utils/captionToggle';
import { showCaptionToast } from '@/utils/captionToast';
import { logConnectionEvent } from '@/utils/connectionLog';

const VideoPlayerContent: React.FC = () => {
  const {
    playerRef,
    playerContainerRef,

    controlsVisible,
    autoCaptions,
    chooseCaption,
    captionEngine,
    subtitleSize,
    cursorVisible,
    useProxy,
    showChannelList,
    showEpisodeList,
    showNextEpisodeButton,
    setShowNextEpisodeButton,
    seekOverlay,
    fitMode,

    streamUrl,
    rawStreamUrl,
    contentType,
    itemId,
    mediaId,
    item,
    seriesItem,
    channels,
    episodes,
    previewChannelInfo,
    channelInfo,
    channelGroups,
    reloadTrigger,
    isRecovering,
    recoveryFailed,
    isTizen,
    streamError,

    onProviderChange,
    handleCanPlay,
    initialPlaybackState,
    handleTimeUpdate,
    handleError,
    handleEnded,
    handleMouseMove,
    setIsTooltipVisible,
    setControlsVisible,
    setCursorVisible,
    setShowChannelList,
    setShowEpisodeList,
    setIsSettingsMenuOpen,
    onChannelSelect,
    onEpisodeSelect,
    playNextEpisode,
    onBack,
    subtitles,
    bestSubtitleLoading,
    pendingTrackId,
    setPendingTrackId,
    pickOnlineSubtitle,
    cancelOnlineSubtitle,
    favorites,
    recentChannels,
    epgData,
  } = useVideoContext();

  const audio = usePlayerVolume(initialPlaybackState);
  const progressId = itemId || mediaId;
  const initialTime = initialPlaybackState?.currentTime;
  const storage = useMemo(() => {
    if (contentType === 'tv') return null;
    return playbackPositionStorage(initialTime, async () => {
      if (!progressId) return 0;
      const records = await getUserProgress();
      const saved = records.find(record => String(record.mediaId) === String(progressId));
      return saved && !saved.completed ? saved.progress : 0;
    });
  }, [contentType, progressId, initialTime]);
  const remote = useMediaRemote(playerRef);
  const source = useProxy ? streamUrl || rawStreamUrl : rawStreamUrl || streamUrl;
  const playerKey = JSON.stringify([reloadTrigger, useProxy, source, progressId]);
  const liveGroup = contentType === 'tv'
    ? channelGroups?.find((g) => String(g.id) === String(channelInfo?.tv_genre_id ?? item?.tv_genre_id))?.title
    : undefined;
  const audioInfo = contentType === 'tv' ? channelInfo ?? item : item;
  const englishAudio = catalogueEnglish(audioInfo, liveGroup, contentType === 'tv' ? audioInfo?.name : undefined);
  const { lines: liveLines, announcement, loading: captionLoading } = useLiveCaptions(playerRef, source && `${reloadTrigger}:${useProxy}:${source}`, englishAudio, autoCaptions, captionEngine);

  // Identity of the playing title, as the server keys catalog items (movie stream id /
  // episode id); live is shown but never reported.
  const qualityItemType: 'movie' | 'episode' | null =
    contentType === 'movie' ? 'movie' : contentType === 'series' ? 'episode' : null;
  const qualityItemId: string | null =
    contentType === 'movie'
      ? String(item?.catalogId ?? item?.stream_id ?? item?.id ?? itemId ?? '').replace(/^movie_/, '') || null
      : contentType === 'series'
        ? String(item?.id ?? itemId ?? '') || null
        : null;
  const videoStats = useVideoQuality(playerContainerRef, { itemType: qualityItemType, itemId: qualityItemId }, `${reloadTrigger}-${streamUrl}`);

  // Per-title subtitle timing (utils/subtitleDelay.ts): bind the title and its text tracks,
  // and re-apply while cues load (applying is idempotent).
  useEffect(() => {
    const titleKey = qualityItemType && qualityItemId ? `${qualityItemType}:${qualityItemId}` : null;
    const tracks = () => {
      const list: any = (playerRef.current as any)?.textTracks;
      if (!list) return [];
      return typeof list.toArray === 'function' ? list.toArray() : Array.from(list as ArrayLike<unknown>);
    };
    bindSubtitleDelay(titleKey, tracks as any);
    const t = window.setInterval(applySubtitleDelay, 1500);
    return () => { window.clearInterval(t); bindSubtitleDelay(null, null); };
  }, [qualityItemType, qualityItemId, playerRef, reloadTrigger]);

  // The online subtitle kept on is reported to the server (utils/subtitleKept.ts), which then
  // lists it first for everyone watching this movie or episode. Checked once a second.
  useEffect(() => {
    if (!qualityItemType || !streamUrl) return;
    let token: string | null = null;
    try { token = new URL(streamUrl, window.location.origin).searchParams.get('t'); } catch { token = null; }
    const tracker = createKeptTracker();
    const timer = window.setInterval(() => {
      const player: any = playerRef.current;
      if (!player) return;
      const list: any = player.textTracks;
      const tracks: any[] = !list ? [] : typeof list.toArray === 'function' ? list.toArray() : Array.from(list as ArrayLike<unknown>);
      const showing = tracks.find((tr) => tr?.mode === 'showing');
      const seconds = Number(player.duration);
      tracker.tick({
        key: onlineSubtitleKey(showing?.src, showing?.id),
        playing: player.paused === false,
        durationMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
        delayMs: getSubtitleDelay(),
        token,
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [qualityItemType, streamUrl, playerRef]);
  const tvChannelListRef = useRef<TvChannelListRef>(null);
  const episodeOverlayRef = useRef<EpisodeOverlayRef>(null);
  const speedBannerRef = useRef<HTMLDivElement>(null);
  const freezeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasFrozenFrame, setHasFrozenFrame] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const captureFrozenFrame = useCallback(() => {
    const video = playerContainerRef.current?.querySelector('video') as HTMLVideoElement | null;
    const canvas = freezeCanvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return;
    }
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setHasFrozenFrame(true);
    } catch {
      // Ignore canvas capture errors on unsupported surfaces.
    }
  }, [playerContainerRef]);

  const clearFrozenFrame = useCallback(() => {
    setHasFrozenFrame(false);
    setReconnecting(false);
    const canvas = freezeCanvasRef.current;
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  // Freeze the current decoded frame synchronously when recovery starts so remounting
  // the player or swapping the stream URL never flashes an empty/black screen.
  useLayoutEffect(() => {
    if (!isRecovering) return;
    captureFrozenFrame();
    setReconnecting(true);
  }, [isRecovering, captureFrozenFrame]);

  useEffect(() => {
    if (recoveryFailed || streamError) {
      setReconnecting(false);
    }
  }, [recoveryFailed, streamError]);

  useEffect(() => {
    clearFrozenFrame();
  }, [itemId, contentType, clearFrozenFrame]);

  const lastCaptionTrackKeyRef = useRef<string | null>(null);
  const activeManualSubIdRef = useRef<string | null>(null);

  useEffect(() => {
    lastCaptionTrackKeyRef.current = null;
    activeManualSubIdRef.current = null;
  }, [itemId, contentType]);

  // Remember any active user-added subtitle (Best match or local SRT) across a
  // same-title player remount (e.g. after a 403 stream URL refresh) and silently
  // restore it once the new player registers its tracks.
  useEffect(() => {
    const player: any = playerRef.current;
    const list: any = player?.textTracks;
    if (!list) return;

    const getTracks = (): any[] =>
      typeof list.toArray === 'function' ? list.toArray() : Array.from(list as ArrayLike<unknown>);

    const restore = () => {
      const wantedId = activeManualSubIdRef.current;
      if (!wantedId || pendingTrackId) return;
      const track = getTracks().find((tr) => String(tr?.id ?? '') === wantedId);
      if (track && track.mode !== 'showing') {
        track.setMode('showing');
      }
    };

    const onModeChange = () => {
      if (playerRef.current !== player) return;
      const tracks = getTracks();
      const showingUser = tracks.find((tr) => tr?.mode === 'showing' && isUserAddedTrack(tr));
      if (showingUser) {
        activeManualSubIdRef.current = String(showingUser.id);
        return;
      }
      const prevId = activeManualSubIdRef.current;
      if (prevId && tracks.some((tr) => String(tr?.id ?? '') === prevId)) {
        activeManualSubIdRef.current = null;
      }
    };

    restore();
    list.addEventListener?.('add', restore);
    list.addEventListener?.('mode-change', onModeChange);
    return () => {
      list.removeEventListener?.('add', restore);
      list.removeEventListener?.('mode-change', onModeChange);
    };
  }, [playerKey, subtitles, pendingTrackId, playerRef]);

  // Activate a newly added online or device subtitle track as soon as Vidstack registers it
  // (works whether Settings is open or closed, e.g. from the C shortcut).
  useEffect(() => {
    if (!pendingTrackId) return;
    const player: any = playerRef.current;
    const list: any = player?.textTracks;
    if (!list) return;

    const activate = () => {
      const tracks: any[] = typeof list.toArray === 'function' ? list.toArray() : Array.from(list as ArrayLike<unknown>);
      const index = tracks.findIndex((tr) => String(tr?.id ?? '') === String(pendingTrackId));
      if (index < 0) return false;
      const track = tracks[index];
      lastCaptionTrackKeyRef.current = captionTrackKey(track);
      chooseCaption(track.id);
      track.setMode('showing');
      setPendingTrackId(null);
      setIsSettingsMenuOpen(false);
      showCaptionToast('success', `Captions on · ${track.label}`, 2500);
      return true;
    };

    if (activate()) return;
    list.addEventListener?.('add', activate);
    return () => {
      list.removeEventListener?.('add', activate);
    };
  }, [pendingTrackId, subtitles, playerKey, playerRef, chooseCaption, setPendingTrackId, setIsSettingsMenuOpen]);

  const toggleCaptions = useCallback(() => {
    const player: any = playerRef.current;
    const list: any = player?.textTracks;
    if (!list) return;
    const tracks: any[] = typeof list.toArray === 'function' ? list.toArray() : Array.from(list as ArrayLike<unknown>);
    const plan = planCaptionToggle({
      tracks,
      contentType,
      lastTrackKey: lastCaptionTrackKeyRef.current,
      preferredLanguage: preferredSubtitleLanguage(),
      isSearchingBest: bestSubtitleLoading,
    });

    switch (plan.action) {
      case 'cancel-search':
        cancelOnlineSubtitle();
        showCaptionToast('info', 'Canceled subtitle search', 1500);
        return;
      case 'off':
        lastCaptionTrackKeyRef.current = plan.trackKey;
        chooseCaption(undefined);
        tracks[plan.index]?.setMode('disabled');
        showCaptionToast('info', 'Captions off', 1500);
        return;
      case 'select': {
        const track = tracks[plan.index];
        if (!track) return;
        lastCaptionTrackKeyRef.current = plan.trackKey;
        chooseCaption(track.id);
        track.setMode('showing');
        showCaptionToast('success', `Captions on · ${track.label || 'On'}`, 2000);
        return;
      }
      case 'best-match':
        void pickOnlineSubtitle(undefined, { source: 'shortcut' });
        return;
      case 'none':
        showCaptionToast('info', 'No captions available', 2000);
        return;
    }
  }, [playerRef, contentType, bestSubtitleLoading, cancelOnlineSubtitle, chooseCaption, pickOnlineSubtitle]);

  const { showExitToast } = useTVRemoteNavigation(
    tvChannelListRef,
    episodeOverlayRef,
    remote,
    toggleCaptions
  );
  const { handleTouchStart, handleTouchEnd, lastTouchTime } = useTouchGestures(
    playerContainerRef,
    speedBannerRef,
    remote
  );
  const fromTouch = (event: React.MouseEvent) =>
    (event.nativeEvent as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } | null })
      .sourceCapabilities?.firesTouchEvents ?? (Date.now() - lastTouchTime.current < 500);

  // TV Browser unexpected pause / stall recovery listener
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const handlePause = () => {
      if ((contentType === 'tv' || player.state.started) && (player.state?.waiting || player.waiting)) {
        setTimeout(() => {
          player.play().catch((err: any) => {
            console.error("[TV Recovery] Forced play failed:", err);
          });
        }, 1000);
      }
    };

    // `stalled` can fire many times a second while the network is degraded
    // (e.g. the server briefly rate-limiting us) — nudging play() on every
    // single event re-requests the manifest with no delay, which is itself
    // enough load to keep the network degraded, in a self-sustaining loop.
    // A short cooldown lets the nudge still recover a genuine one-off stall
    // without becoming a retry storm.
    let lastStallNudge = 0;
    const handleStalled = () => {
      const now = Date.now();
      if (now - lastStallNudge < 3000) return;
      lastStallNudge = now;
      logConnectionEvent({
        source: 'player',
        event: 'player-stalled',
        level: 'warn',
        contentType,
        title: item?.title || seriesItem?.title || channelInfo?.name || undefined,
        currentTime: Number.isFinite(player.currentTime) ? player.currentTime : undefined,
        url: source || undefined,
      });
      if (player.paused && (contentType === 'tv' || player.state.started)) {
        player.play().catch(() => {});
      }
    };

    player.addEventListener('pause', handlePause);
    player.addEventListener('stalled', handleStalled);

    return () => {
      player.removeEventListener('pause', handlePause);
      player.removeEventListener('stalled', handleStalled);
    };
  }, [playerKey, contentType, playerRef, item?.title, seriesItem?.title, channelInfo?.name, source]);

  const videoSrc = useMemo<PlayerSrc>(() => {
    if (!source) return '';
    const isM3u8 =
      (rawStreamUrl && rawStreamUrl.toLowerCase().includes('m3u8')) ||
      source.toLowerCase().includes('m3u8');
    return {
      src: source,
      type: isM3u8 ? 'application/x-mpegurl' : 'video/mp4',
    } as PlayerSrc;
  }, [source, rawStreamUrl]);

  return (
    <div
      className="h-dvh w-full bg-black"
      data-focusable="true"
      tabIndex={-1}
      style={{ '--video-fit-mode': fitMode } as React.CSSProperties}
    >
      <div
        ref={playerContainerRef}
        data-frozen-frame={hasFrozenFrame ? 'true' : undefined}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setIsTooltipVisible(false);
          setControlsVisible(false);
          setCursorVisible(false);
        }}
        className={`group relative h-full w-full overflow-hidden ${!cursorVisible && !controlsVisible ? 'cursor-none' : ''}`}
      >
        <canvas
          ref={freezeCanvasRef}
          aria-hidden="true"
          style={{ objectFit: fitMode }}
          className={`pointer-events-none absolute inset-0 z-0 h-full w-full bg-black ${hasFrozenFrame ? 'opacity-100' : 'opacity-0'}`}
        />
        <MediaPlayer
          key={playerKey}
          className="media-provider relative z-10 h-full w-full"
          data-subtitle-size={subtitleSize}
          title={
            item?.title || seriesItem?.title || channelInfo?.name || 'Video'
          }
          src={videoSrc}
          viewType="video"
          streamType={contentType === 'tv' ? 'live' : 'on-demand'}
          googleCast={{
            autoJoinPolicy: 'origin_scoped' as any,
            language: 'en-US',
          }}
          playsInline
          autoplay
          storage={storage}
          load="eager"
          ref={playerRef}
          onProviderChange={onProviderChange}
          onCanPlay={() => {
            handleCanPlay();
            void applyDialogueBoost(playerRef.current?.el?.querySelector('video, audio'));
          }}
          onPlaying={clearFrozenFrame}
          onAutoPlayFail={clearFrozenFrame}
          volume={audio.volume}
          muted={audio.muted}
          onVolumeChange={audio.onVolumeChange}
          onTimeUpdate={handleTimeUpdate}
          onError={handleError}
          onEnded={handleEnded}
          keyDisabled={true}
        >
          <MediaProvider>
            {item?.subtitles?.map((sub: any, index: number) => (
              <track
                key={index}
                id={sub.id ? String(sub.id) : `item_sub_${index}`}
                src={sub.url}
                kind="subtitles"
                label={sub.language}
                srcLang={sub.langCode}
                default={index === 0}
              />
            ))}
            {subtitles?.map((sub) => (
              <track
                key={sub.id}
                id={String(sub.id)}
                src={sub.src}
                kind="subtitles"
                label={sub.label}
                srcLang={sub.srclang}
              />
            ))}
          </MediaProvider>

          {/* The picture and letterbox bars are one tap target, underneath the interactive controls. */}
          <div
            className="absolute inset-0 z-10 touch-none"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={(event) => {
              if (fromTouch(event)) return;
              remote.togglePaused();
            }}
            onDoubleClick={(event) => {
              if (!isTizen && !fromTouch(event)) remote.toggleFullscreen();
            }}
          />

          <Captions
            className={`media-captions pointer-events-none absolute left-0 right-0 z-10 select-none wrap-break-word text-center transition-[bottom] duration-300 ease-in-out ${
              controlsVisible
                ? 'bottom-32 md:bottom-40'
                : 'bottom-10 md:bottom-12'
            }`}
          />

          <div className="sr-only" aria-live="polite" aria-atomic="true">{captionLoading || announcement}</div>
          {(captionLoading || liveLines.length > 0) && (
            <div
              aria-hidden="true"
              className={`live-captions pointer-events-none absolute inset-x-0 z-30 mx-auto select-none ${controlsVisible ? 'bottom-[min(12rem,45%)] md:bottom-[min(16rem,45%)]' : 'bottom-10 md:bottom-12'}`}
            >
              <div className="live-caption-lines">
                {captionLoading && <span className="live-caption-background text-sm">{captionLoading}</span>}
                {liveLines.map(line => (
                  <div key={line.start}>
                    <span className="live-caption-background">
                      {line.text.split(' ').map((word, index) => (
                        <React.Fragment key={line.start + index}>
                          {index > 0 && ' '}<span className="live-caption-word">{word}</span>
                        </React.Fragment>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outside the fading controls: it shows whether they are up or not. */}
          {contentType !== 'tv' && <PlayPauseFlash />}

          <div
            data-visible={controlsVisible}
            className={`player-chrome pointer-events-none absolute inset-0 z-20 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'} ${seekOverlay?.isLeftRight ? 'seek-bar-only' : ''}`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <TopBar onBack={onBack} stats={videoStats} />

            {contentType === 'tv' ? (
              <TVControls />
            ) : (
              <>
                <SeekOverlay seekOverlay={seekOverlay} />
                <VODControls />
              </>
            )}
          </div>

          {showChannelList &&
            contentType === 'tv' &&
            channels &&
            onChannelSelect && (
              <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                <TvChannelList
                  ref={tvChannelListRef}
                  channels={channels}
                  channelGroups={channelGroups || []}
                  onChannelSelect={(item) => {
                    onChannelSelect(item);
                    setShowChannelList(false);
                  }}
                  onBack={() => setShowChannelList(false)}
                  currentItemId={itemId}
                  isOverlay={true}
                  favorites={favorites}
                  recentChannels={recentChannels}
                  epgData={epgData}
                />
              </div>
            )}

          {showEpisodeList &&
            episodes &&
            onEpisodeSelect && (
              <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                <EpisodeOverlay
                  ref={episodeOverlayRef}
                  episodes={episodes}
                  onEpisodeSelect={(item) => {
                    onEpisodeSelect(item);
                    setShowEpisodeList(false);
                  }}
                  onBack={() => setShowEpisodeList(false)}
                  currentItemId={item?._episodeCardId || itemId}
                />
              </div>
            )}

          {/* Recovery keeps the last video frame frozen via freezeCanvasRef + subtle indicator below. */}

          {streamError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black pointer-events-none">
              <div className="ui-player-float w-[90%] max-w-md p-6 rounded-xl border border-line bg-panel/95 text-center shadow-2xl shadow-black/80 space-y-3">
                <h3 className="text-lg font-bold text-red-500 tracking-wide">
                  Error 404: Signal Not Found
                </h3>
                <p className="text-sm text-fg-soft font-medium leading-relaxed px-2">
                  We are currently unable to fetch the broadcast from the provider. Please try again later
                </p>
              </div>
            </div>
          )}

          {previewChannelInfo && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
              <div className="ui-player-float rounded-lg bg-black bg-opacity-75 p-6 shadow-xl">
                <h2 className="text-center text-5xl font-bold text-fg">
                  {previewChannelInfo.number}
                </h2>
                <h3 className="mt-2 text-center text-2xl text-fg-soft">
                  {previewChannelInfo.name}
                </h3>
              </div>
            </div>
          )}

          {showExitToast && (
            <div className="ui-player-float pointer-events-none absolute bottom-20 left-1/2 z-100 -translate-x-1/2 rounded-full border border-line-strong bg-black/90 px-6 py-3 text-fg shadow-xl backdrop-blur-md transition-all duration-300">
              <span className="text-sm font-medium tracking-wide">
                Press BACK again to exit
              </span>
            </div>
          )}

          {showNextEpisodeButton && (
            <div className="absolute bottom-24 right-8 z-90 flex items-center gap-3">
              <button
                data-focusable="true"
                data-control="next-episode"
                onClick={() => {
                  setShowNextEpisodeButton(false);
                  playNextEpisode?.();
                }}
                className="ui-player-float flex items-center gap-2 px-5 py-3 rounded-lg border border-line bg-black/80 text-fg font-semibold shadow-lg backdrop-blur-md hover:bg-interaction transition-all duration-200 outline-hidden focus:ring-2 focus:ring-focus focus:[background:var(--ui-selected-bg)] focus:border-focus"
              >
                <span>Next Episode</span>
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" stroke="currentColor" strokeWidth="1" />
                </svg>
              </button>
            </div>
          )}

          <div
            ref={speedBannerRef}
            style={{ display: 'none' }}
            className="absolute top-10 left-1/2 -translate-x-1/2 z-100 pointer-events-none flex items-center gap-2 px-4 py-2 rounded-full border border-yellow-500/30 bg-black/80 shadow-lg backdrop-blur-xs"
          >
            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
            <span className="text-yellow-500 text-xs font-bold tracking-wider uppercase">2x Speed Active</span>
          </div>

          <BufferingOverlay hidden={reconnecting} />
        </MediaPlayer>
        {reconnecting && !streamError && !showChannelList && !showEpisodeList && (
          <div
            aria-live="polite"
            aria-label="Reconnecting"
            data-ui="reconnecting-indicator"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-xs">
              <ActivityIndicator className="text-lg text-white/85" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoPlayerContent;
