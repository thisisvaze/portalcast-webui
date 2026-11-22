import React, { useMemo, useState, useEffect, useRef } from 'react';
import { FaChromecast } from 'react-icons/fa';
import {
  Maximize2,
  SettingsIcon,
  ShieldCheck,
  ShieldX,
  Shrink,
  SquareDashedBottomCode,
  MoreVertical,
} from 'lucide-react';

// --- Vidstack Native Hooks ---
import { useMediaState, useMediaRemote } from '@vidstack/react';

import {
  PlayIcon,
  PauseIcon,
  ListIcon,
  HeartSolidIcon,
  HeartOutlineIcon,
  FullscreenExitIcon,
  FullscreenIcon,
} from '@/components/atoms/Icons';
import { URL_PATHS } from '@/api/config';
import { SettingsMenu } from '@/components/molecules/SettingsMenu';
import { VolumeControl } from '@/components/molecules/VolumeControl';
import { useVideoContext } from '@/context/video';
import {
  isBehindLiveEdge,
  LIVE_EDGE_TOLERANCE_SECONDS,
} from '@/utils/liveEdge';

const formatTimestamp = (timestamp: number): string => {
  if (isNaN(timestamp)) return '...';
  return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

export const TVControls = React.memo(() => {
  // 1. App-Specific State (From Context)
  const {
    channelInfo,
    previewChannelInfo,
    currentProgram,
    nextProgram,
    programProgress,
    liveTime,
    isFavorite,
    fitMode,
    isTizen,
    isSettingsMenuOpen,
    activeSettingsMenu,
    isReceiver,
    toggleChannelList: onToggleChannelList,
    goLive,
    cycleFitMode: onCycleFitMode,
    toggleFavorite: onToggleFavorite,
    setActiveSettingsMenu: onActiveSettingsMenuChange,
    setIsSettingsMenuOpen: onSetIsSettingsMenuOpen,
    refreshReceivers,
    useProxy,
    setUseProxy,
    controlsVisible,
  } = useVideoContext();

  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  useEffect(() => {
    if (!controlsVisible) {
      setIsMoreMenuOpen(false);
    }
  }, [controlsVisible]);

  // 2. Video-Specific State (From Vidstack Native Hooks)
  const remote = useMediaRemote(); // Used to send commands to the player
  const isPaused = useMediaState('paused');
  const isPlaying = !isPaused;
  const isFullscreen = useMediaState('fullscreen');
  const currentTime = useMediaState('currentTime');
  const liveSyncPosition = useMediaState('liveSyncPosition');

  const baseUrl = URL_PATHS.HOST === '/' ? '' : URL_PATHS.HOST;
  const activeChannel = previewChannelInfo || channelInfo;
  const pausedAtRef = useRef<number | null>(null);
  const [resumedBehind, setResumedBehind] = useState(false);

  useEffect(() => {
    pausedAtRef.current = null;
    setResumedBehind(false);
  }, [activeChannel?.id]);

  useEffect(() => {
    if (isPaused) {
      if (pausedAtRef.current == null) pausedAtRef.current = Date.now();
    } else if (pausedAtRef.current != null) {
      if (
        Date.now() - pausedAtRef.current >=
        LIVE_EDGE_TOLERANCE_SECONDS * 1000
      ) {
        setResumedBehind(true);
      }
      pausedAtRef.current = null;
    }
  }, [isPaused]);

  const behindLive = isBehindLiveEdge({
    paused: isPaused,
    currentTime,
    liveSyncPosition,
    resumedBehind,
  });

  const handleGoLive = () => {
    pausedAtRef.current = null;
    setResumedBehind(false);
    goLive();
  };

  const channelImgSrc = useMemo(() => {
    if (!activeChannel?.screenshot_uri) return null;
    return activeChannel.screenshot_uri.startsWith('http')
      ? activeChannel.screenshot_uri
      : `${baseUrl}/api/images${activeChannel.screenshot_uri}`;
  }, [activeChannel, baseUrl]);

  const currentProgName =
    currentProgram?.name || activeChannel?.name || 'Current Program';
  const currentProgTime = currentProgram
    ? `${formatTimestamp(parseInt(currentProgram.start_timestamp))} - ${formatTimestamp(parseInt(currentProgram.stop_timestamp))}`
    : previewChannelInfo
      ? '...'
      : 'Now';

  const nextProgName =
    nextProgram?.name || (previewChannelInfo ? '...' : 'Next Program');
  const nextProgTime = nextProgram
    ? formatTimestamp(parseInt(nextProgram.start_timestamp))
    : '...';

  return (
    <div className="text-fg pointer-events-none absolute inset-x-2 bottom-2 md:inset-x-6 md:bottom-4">
      <div className="ui-player-panel pointer-events-auto mx-auto w-full max-w-3xl rounded-xl px-2.5 py-2 shadow-2xl md:px-4 md:py-2.5">
        <div className="mb-1 flex items-center justify-between gap-2 md:mb-1.5">
          <div className="flex min-w-0 items-center">
            {channelImgSrc && (
              <img
                src={channelImgSrc}
                alt={activeChannel?.name || 'Channel Logo'}
                className="mr-1.5 h-5 w-7 shrink-0 rounded-xs bg-black object-contain p-px md:mr-2.5 md:h-7 md:w-9"
              />
            )}
            <span className="text-sm font-bold tabular-nums md:text-lg">
              {activeChannel?.number}
            </span>
            <span className="ml-1.5 truncate text-xs font-semibold md:ml-2.5 md:text-base">
              {activeChannel?.name}
            </span>
          </div>
          <div className="text-fg-soft shrink-0 text-xs tabular-nums md:text-sm">
            {liveTime}
          </div>
        </div>

        <div className="space-y-0.5">
          <div className="ui-player-now flex items-center justify-between gap-2 rounded-md px-2 py-1 md:px-2.5">
            <span className="text-3xs truncate font-semibold md:text-sm">
              {currentProgName}
            </span>
            <span className="shrink-0 text-[9px] tabular-nums md:text-xs">
              {currentProgTime}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 px-2 py-0.5 md:px-2.5">
            <span className="text-3xs text-fg-soft truncate md:text-xs">
              {nextProgName}
            </span>
            <span className="text-fg-soft shrink-0 text-[9px] tabular-nums md:text-xs">
              {nextProgTime}
            </span>
          </div>
        </div>

        <div className="ui-player-track mt-1.5 h-1 w-full rounded-full md:mt-2">
          <div
            className="ui-player-progress h-1 rounded-full"
            style={{ width: `${programProgress}%` }}
          />
        </div>

        <div className="text-fg-soft mt-1.5 flex items-center justify-between px-0.5 text-sm md:mt-2">
          <div className="flex items-center gap-2 md:gap-3.5">
            {/* Vidstack Remote actions mapped here */}
            <button
              data-focusable="true"
              data-control="play-pause"
              data-tip={isPaused ? 'Play' : 'Pause'}
              aria-label={isPaused ? 'Play' : 'Pause'}
              onClick={() => (isPaused ? remote.play() : remote.pause())}
              className="text-fg hover:text-accent"
            >
              {isPlaying ? (
                <PauseIcon className="h-4 w-4 md:h-5 md:w-5" />
              ) : (
                <PlayIcon className="h-4 w-4 md:h-5 md:w-5" />
              )}
            </button>
            {behindLive ? (
              <button
                type="button"
                data-focusable="true"
                onClick={handleGoLive}
                className="text-fg hover:text-accent inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors hover:bg-white/20 md:text-sm"
              >
                <span
                  className="bg-fg-muted h-2 w-2 rounded-full"
                  aria-hidden="true"
                />
                Go Live
              </button>
            ) : (
              <span
                aria-label="Live"
                className="text-fg-soft inline-flex items-center gap-1.5 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap md:text-sm"
              >
                <span
                  className="bg-live h-2 w-2 rounded-full"
                  aria-hidden="true"
                />
                Live
              </span>
            )}
            <button
              data-focusable="true"
              onClick={onToggleChannelList}
              data-tip="Channels"
              aria-label="Channels"
              className="text-fg hover:text-accent"
            >
              <ListIcon className="h-4 w-4 md:h-5 md:w-5" />
            </button>
          </div>

          <div className="flex items-center gap-2 md:gap-3.5">
            <button
              data-focusable="true"
              className="text-fg hover:text-accent hidden md:block"
              onClick={() => setUseProxy(!useProxy)}
              data-tip={useProxy ? 'Proxy on' : 'Proxy off'}
              aria-label="Proxy"
            >
              {!useProxy ? (
                <ShieldX className="h-4 w-4 md:h-5 md:w-5" />
              ) : (
                <ShieldCheck className="h-4 w-4 md:h-5 md:w-5" />
              )}
            </button>
            <button
              data-focusable="true"
              onClick={onCycleFitMode}
              className="text-fg hover:text-accent hidden md:block"
              data-tip={`Scale: ${fitMode === 'contain' ? 'fit' : fitMode === 'cover' ? 'fill' : 'stretch'}`}
              aria-label="Video scale"
            >
              {fitMode === 'contain' && (
                <Shrink className="h-4 w-4 md:h-5 md:w-5" />
              )}
              {fitMode === 'cover' && (
                <SquareDashedBottomCode className="h-4 w-4 md:h-5 md:w-5" />
              )}
              {fitMode === 'fill' && (
                <Maximize2 className="h-4 w-4 md:h-5 md:w-5" />
              )}
            </button>

            <div className="relative flex items-center gap-2 md:gap-3.5">
              {!isReceiver && (
                <button
                  data-focusable="true"
                  onClick={() => {
                    refreshReceivers();
                    if (isSettingsMenuOpen && activeSettingsMenu === 'cast') {
                      onSetIsSettingsMenuOpen(false);
                    } else {
                      onSetIsSettingsMenuOpen(true);
                      onActiveSettingsMenuChange('cast');
                    }
                  }}
                  data-tip="Cast"
                  aria-label="Cast"
                  className="text-fg hover:text-accent hidden md:block"
                >
                  <FaChromecast className="h-4 w-4 md:h-5 md:w-5" />
                </button>
              )}
              <div className="relative flex items-center justify-center">
                {
                  <button
                    data-focusable="true"
                    onClick={() => onSetIsSettingsMenuOpen((v) => !v)}
                    data-tip="Settings"
                    aria-label="Settings"
                    className="text-fg hover:text-accent hidden md:block"
                  >
                    <SettingsIcon className="h-4 w-4 md:h-5 md:w-5" />
                  </button>
                }
                {/* 👇 Menu ippo intha relative div-ku ulla irukkirathunala, correct-a button mela ukkarum */}
                <SettingsMenu />
              </div>
            </div>

            <button
              data-focusable="true"
              onClick={() => onToggleFavorite(activeChannel)}
              data-tip={
                isFavorite ? 'Remove from favourites' : 'Add to favourites'
              }
              aria-label={
                isFavorite ? 'Remove from favourites' : 'Add to favourites'
              }
              className="text-fg hover:text-yellow-400"
            >
              {isFavorite ? (
                <HeartSolidIcon className="h-4 w-4 text-yellow-400 md:h-5 md:w-5" />
              ) : (
                <HeartOutlineIcon className="h-4 w-4 md:h-5 md:w-5" />
              )}
            </button>

            {!isTizen && (
              <>
                <div className="[&_svg]:h-4! [&_svg]:w-4! md:[&_svg]:h-5! md:[&_svg]:w-5!">
                  <VolumeControl />
                </div>
                <button
                  data-focusable="true"
                  onClick={() => remote.toggleFullscreen()}
                  data-tip={isFullscreen ? 'Exit full screen' : 'Full screen'}
                  aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                  className="text-fg hover:text-accent"
                >
                  {isFullscreen ? (
                    <FullscreenExitIcon className="h-4 w-4 md:h-5 md:w-5" />
                  ) : (
                    <FullscreenIcon className="h-4 w-4 md:h-5 md:w-5" />
                  )}
                </button>
              </>
            )}

            {/* Mobile More Options Button */}
            <div className="relative flex items-center justify-center md:hidden">
              <button
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className="text-fg hover:text-accent p-1.5 transition-colors"
                title="More Options"
              >
                <MoreVertical className="h-5 w-5" />
              </button>
              {isMoreMenuOpen && (
                <div className="more-options-menu border-divider/40 bg-panel/95 text-fg absolute right-0 bottom-[calc(100%+12px)] z-50 flex w-48 origin-bottom-right flex-col rounded-xl border p-2 text-sm shadow-[0_-10px_40px_rgba(0,0,0,0.7)] backdrop-blur-xl">
                  <button
                    onClick={() => {
                      setUseProxy(!useProxy);
                      setIsMoreMenuOpen(false);
                    }}
                    className="hover:bg-interaction flex items-center space-x-3 rounded-sm px-3 py-2 transition-colors"
                  >
                    {!useProxy ? (
                      <ShieldX className="text-fg-muted h-4 w-4" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 text-green-400" />
                    )}
                    <span>Proxy: {useProxy ? 'On' : 'Off'}</span>
                  </button>

                  <button
                    onClick={() => {
                      onCycleFitMode();
                    }}
                    className="hover:bg-interaction flex items-center space-x-3 rounded-sm px-3 py-2 transition-colors"
                  >
                    {fitMode === 'contain' && (
                      <Shrink className="text-fg-muted h-4 w-4" />
                    )}
                    {fitMode === 'cover' && (
                      <SquareDashedBottomCode className="text-fg-muted h-4 w-4" />
                    )}
                    {fitMode === 'fill' && (
                      <Maximize2 className="text-fg-muted h-4 w-4" />
                    )}
                    <span className="capitalize">{fitMode}</span>
                  </button>

                  {!isReceiver && (
                    <button
                      onClick={() => {
                        refreshReceivers();
                        onSetIsSettingsMenuOpen(true);
                        onActiveSettingsMenuChange('cast');
                        setIsMoreMenuOpen(false);
                      }}
                      className="hover:bg-interaction flex items-center space-x-3 rounded-sm px-3 py-2 transition-colors"
                    >
                      <FaChromecast className="text-fg-muted h-4 w-4" />
                      <span>Cast</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      onSetIsSettingsMenuOpen(true);
                      onActiveSettingsMenuChange('main');
                      setIsMoreMenuOpen(false);
                    }}
                    className="hover:bg-interaction flex items-center space-x-3 rounded-sm px-3 py-2 transition-colors"
                  >
                    <SettingsIcon className="text-fg-muted h-4 w-4" />
                    <span>Settings</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

TVControls.displayName = 'TVControls';
