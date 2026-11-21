/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { isHLSProvider, type MediaProviderAdapter } from '@vidstack/react';
import { authFetch } from '@/api/client';
import { logConnectionEvent } from '@/utils/connectionLog';
import {
  decideHlsErrorAction,
  extractHlsErrorInfo,
  extractPlayerErrorInfo,
  isRefreshableHttpStatus,
  MAX_URL_REFRESHES,
  urlRefreshDelayMs,
} from '@/utils/hlsRecoveryPolicy';

export interface UseHlsRecoveryOptions {
  contentType: 'movie' | 'series' | 'tv';
  streamUrl: string | null | undefined;
  playerRef: React.RefObject<any>;
  itemId?: string | null;
  title?: string;
  lastGoodTimeRef?: React.RefObject<number>;
  onRefreshStreamUrl?: (resumeAt?: number) => Promise<string | null>;
}

// Owns the hls.js error-recovery/retry state machine — extracted from
// VideoContext.tsx. Logs stream errors/recoveries to the connection ring buffer,
// refreshes expired/rejected VOD stream URLs on HTTP 401/403 instead of looping
// on a dead token, and tries hls.js's in-place startLoad()/recoverMediaError()
// before falling back to a full player remount.
export function useHlsRecovery({
  contentType,
  streamUrl,
  playerRef,
  itemId,
  title,
  lastGoodTimeRef,
  onRefreshStreamUrl,
}: UseHlsRecoveryOptions) {
  const hlsInstanceRef = useRef<any>(null);
  const networkRecoveryAttempted = useRef(false);
  const mediaErrorRecoveryAttempted = useRef(false);
  const isRetrying = useRef(false);
  const refreshInFlightRef = useRef(false);
  const refreshCountRef = useRef(0);
  const consecutiveForbiddenRef = useRef(0);
  const hadErrorsRef = useRef(false);
  const handledFatalAtRef = useRef(0);
  const lastHlsErrorRef = useRef<{
    status: number | null;
    details?: string;
    url?: string;
    at: number;
  } | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const [retryCount, setRetryCount] = useState(0);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const retryCountRef = useRef(retryCount);
  retryCountRef.current = retryCount;
  const streamUrlRef = useRef(streamUrl);
  streamUrlRef.current = streamUrl;
  const itemIdRef = useRef(itemId);
  itemIdRef.current = itemId;
  const titleRef = useRef(title);
  titleRef.current = title;
  const onRefreshRef = useRef(onRefreshStreamUrl);
  onRefreshRef.current = onRefreshStreamUrl;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  // Reset per-title budgets only when switching to a different title/channel,
  // not when swapping streamUrl for the same title during a 403 URL refresh.
  useEffect(() => {
    clearRetryTimer();
    refreshCountRef.current = 0;
    refreshInFlightRef.current = false;
    consecutiveForbiddenRef.current = 0;
    hadErrorsRef.current = false;
    handledFatalAtRef.current = 0;
    lastHlsErrorRef.current = null;
    isRetrying.current = false;
    networkRecoveryAttempted.current = false;
    mediaErrorRecoveryAttempted.current = false;
    setStreamError(null);
    setRetryCount(0);
    setIsRecovering(false);
  }, [itemId, contentType, clearRetryTimer]);

  const currentPlaybackTime = useCallback((): number | undefined => {
    const live = Number(playerRef.current?.currentTime);
    if (Number.isFinite(live) && live > 2) return live;
    const saved = lastGoodTimeRef?.current ?? 0;
    if (Number.isFinite(saved) && saved > 2) return saved;
    return Number.isFinite(live) && live >= 0 ? live : undefined;
  }, [playerRef, lastGoodTimeRef]);

  // Called when streamUrl changes (including after a URL refresh) — clears
  // transient retry flags while preserving refreshCountRef/hadErrorsRef so a
  // repeated 403 after refresh cannot loop forever.
  const resetRecoveryState = useCallback(() => {
    clearRetryTimer();
    setIsRecovering(false);
    isRetrying.current = false;
    refreshInFlightRef.current = false;
    consecutiveForbiddenRef.current = 0;
    lastHlsErrorRef.current = null;
    networkRecoveryAttempted.current = false;
    mediaErrorRecoveryAttempted.current = false;
    if (refreshCountRef.current === 0) {
      setRetryCount(0);
    }
  }, [clearRetryTimer]);

  // Called when playback genuinely succeeds (canplay) — clears all recovery
  // budgets and logs recovery if this playback had hit errors.
  const markPlaybackRecovered = useCallback(() => {
    if (hadErrorsRef.current) {
      logConnectionEvent({
        source: 'player',
        event: 'stream-recovery',
        level: 'info',
        action: 'recovered',
        retryCount: refreshCountRef.current || retryCountRef.current,
        contentType,
        title: titleRef.current,
        currentTime: currentPlaybackTime(),
        url: streamUrlRef.current || undefined,
      });
    }
    hadErrorsRef.current = false;
    refreshCountRef.current = 0;
    handledFatalAtRef.current = 0;
    setRetryCount(0);
    resetRecoveryState();
  }, [contentType, currentPlaybackTime, resetRecoveryState]);

  const triggerUrlRefresh = useCallback(
    async (status: number | null, delayMs: number, reason?: string): Promise<boolean> => {
      if (refreshInFlightRef.current || !onRefreshRef.current) return false;
      clearRetryTimer();

      const targetItemId = itemIdRef.current;
      refreshInFlightRef.current = true;
      isRetrying.current = true;
      hadErrorsRef.current = true;
      setIsRecovering(true);

      const attempt = refreshCountRef.current + 1;
      refreshCountRef.current = attempt;
      setRetryCount(attempt);

      const resumeAt = currentPlaybackTime();
      try {
        hlsInstanceRef.current?.stopLoad?.();
      } catch {
        // Ignore stopLoad errors on torn-down instances.
      }

      logConnectionEvent({
        source: 'player',
        event: 'stream-recovery',
        level: 'warn',
        action: 'refresh-url',
        status,
        retryCount: attempt,
        reason,
        contentType,
        title: titleRef.current,
        currentTime: resumeAt,
        url: streamUrlRef.current || undefined,
      });

      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            resolve();
          }, delayMs);
        });
        if (!mountedRef.current || itemIdRef.current !== targetItemId) {
          refreshInFlightRef.current = false;
          isRetrying.current = false;
          return false;
        }
      }

      try {
        const freshUrl = await onRefreshRef.current(resumeAt);
        if (!mountedRef.current || itemIdRef.current !== targetItemId) {
          refreshInFlightRef.current = false;
          isRetrying.current = false;
          return false;
        }
        if (freshUrl) {
          logConnectionEvent({
            source: 'player',
            event: 'stream-recovery',
            level: 'info',
            action: 'refresh-url-ok',
            status,
            retryCount: attempt,
            contentType,
            title: titleRef.current,
            currentTime: resumeAt,
            url: freshUrl,
          });
          consecutiveForbiddenRef.current = 0;
          refreshInFlightRef.current = false;
          isRetrying.current = false;
          if (freshUrl === streamUrlRef.current) {
            setReloadTrigger((prev) => prev + 1);
            setIsRecovering(false);
          }
          return true;
        }

        logConnectionEvent({
          source: 'player',
          event: 'stream-recovery',
          level: 'error',
          action: 'refresh-url-failed',
          status,
          retryCount: attempt,
          reason: 'no-fresh-url',
          contentType,
          title: titleRef.current,
          currentTime: resumeAt,
        });
      } catch (err: any) {
        logConnectionEvent({
          source: 'player',
          event: 'stream-recovery',
          level: 'error',
          action: 'refresh-url-failed',
          status,
          retryCount: attempt,
          reason: err?.message || String(err),
          contentType,
          title: titleRef.current,
          currentTime: resumeAt,
        });
      }

      if (!mountedRef.current || itemIdRef.current !== targetItemId) {
        refreshInFlightRef.current = false;
        isRetrying.current = false;
        return false;
      }

      refreshInFlightRef.current = false;
      isRetrying.current = false;

      if (attempt < MAX_URL_REFRESHES) {
        return triggerUrlRefresh(status, urlRefreshDelayMs(attempt), 'retry-after-refresh-error');
      }

      logConnectionEvent({
        source: 'player',
        event: 'stream-recovery',
        level: 'error',
        action: 'give-up',
        status,
        retryCount: attempt,
        reason: 'refresh-failed',
        contentType,
        title: titleRef.current,
        currentTime: resumeAt,
      });
      setIsRecovering(false);
      toast.error(`Stream access rejected by provider (${status ?? 403}). Please try again shortly.`);
      return false;
    },
    [clearRetryTimer, contentType, currentPlaybackTime]
  );

  const onProviderChange = useCallback(
    (provider: MediaProviderAdapter | null) => {
      hlsInstanceRef.current = null;
      if (provider && isHLSProvider(provider)) {
        provider.config = {
          enableSoftwareAES: true,
          enableWorker: true,
          stretchShortVideoTrack: true,
          manifestLoadingTimeOut: 30000, // 30s
          manifestLoadingMaxRetry: 10,
          manifestLoadingRetryDelay: 1000,
          levelLoadingTimeOut: 30000, // 30s
          levelLoadingMaxRetry: 10,
          levelLoadingRetryDelay: 1000,
          fragLoadingTimeOut: 30000, // 30s
          fragLoadingMaxRetry: 10,
          fragLoadingRetryDelay: 1000,
        };

        // Listen for hls.js instances and attach error listeners
        (provider as any).onInstance?.((hlsInstance: any) => {
          hlsInstanceRef.current = hlsInstance;
          if (!hlsInstance) return;
          networkRecoveryAttempted.current = false;
          mediaErrorRecoveryAttempted.current = false;

          hlsInstance.on('hlsFragLoaded', () => {
            consecutiveForbiddenRef.current = 0;
            networkRecoveryAttempted.current = false;
          });

          hlsInstance.on('hlsError', (_event: any, data: any) => {
            const info = extractHlsErrorInfo(data);
            if (isRefreshableHttpStatus(info.status)) {
              consecutiveForbiddenRef.current += 1;
            } else if (info.status !== null) {
              consecutiveForbiddenRef.current = 0;
            }

            lastHlsErrorRef.current = {
              status: info.status,
              details: info.details,
              url: info.url,
              at: Date.now(),
            };
            hadErrorsRef.current = true;

            logConnectionEvent({
              source: 'player',
              event: 'hls-error',
              level: info.fatal ? 'error' : 'warn',
              status: info.status,
              fatal: info.fatal,
              type: info.type,
              details: info.details,
              reason: info.reason,
              url: info.url || streamUrlRef.current || undefined,
              title: titleRef.current,
              contentType,
              currentTime: currentPlaybackTime(),
              retryCount: retryCountRef.current,
            });

            if (refreshInFlightRef.current) return;

            const action = decideHlsErrorAction({
              contentType,
              type: info.type,
              fatal: info.fatal,
              status: info.status,
              consecutiveForbidden: consecutiveForbiddenRef.current,
              canRefreshUrl: Boolean(onRefreshRef.current),
              refreshCount: refreshCountRef.current,
              networkRecoveryAttempted: networkRecoveryAttempted.current,
              mediaErrorRecoveryAttempted: mediaErrorRecoveryAttempted.current,
            });

            if (action.kind === 'ignore' || action.kind === 'fallback-handle-error') {
              return;
            }

            if (action.kind === 'not-found') {
              handledFatalAtRef.current = Date.now();
              setStreamError('Channel is not available 404 status');
              setIsRecovering(false);
              logConnectionEvent({
                source: 'player',
                event: 'stream-recovery',
                level: 'error',
                action: 'give-up',
                status: 404,
                reason: 'channel-not-found',
                contentType,
                title: titleRef.current,
                url: info.url || streamUrlRef.current || undefined,
              });
              return;
            }

            if (action.kind === 'refresh-url') {
              handledFatalAtRef.current = Date.now();
              void triggerUrlRefresh(info.status, action.delayMs, info.details || 'hls-auth-error');
              return;
            }

            if (action.kind === 'forbidden-exhausted') {
              handledFatalAtRef.current = Date.now();
              try {
                hlsInstance.stopLoad();
              } catch {
                // Ignore stopLoad errors.
              }
              setIsRecovering(false);
              logConnectionEvent({
                source: 'player',
                event: 'stream-recovery',
                level: 'error',
                action: 'give-up',
                status: info.status,
                retryCount: refreshCountRef.current,
                reason: 'refresh-limit-reached',
                contentType,
                title: titleRef.current,
                currentTime: currentPlaybackTime(),
                url: info.url || streamUrlRef.current || undefined,
              });
              toast.error(`Stream access rejected by provider (${info.status ?? 403}). Please try again shortly.`);
              return;
            }

            if (action.kind === 'start-load') {
              networkRecoveryAttempted.current = true;
              handledFatalAtRef.current = Date.now();
              logConnectionEvent({
                source: 'player',
                event: 'stream-recovery',
                level: 'warn',
                action: 'start-load',
                status: info.status,
                details: info.details,
                contentType,
                title: titleRef.current,
                currentTime: currentPlaybackTime(),
                url: info.url || streamUrlRef.current || undefined,
              });
              try {
                hlsInstance.startLoad();
                return;
              } catch (e) {
                handledFatalAtRef.current = 0;
                console.error('[VideoPlayer] startLoad() failed, falling back to remount', e);
              }
              return;
            }

            if (action.kind === 'recover-media') {
              mediaErrorRecoveryAttempted.current = true;
              handledFatalAtRef.current = Date.now();
              logConnectionEvent({
                source: 'player',
                event: 'stream-recovery',
                level: 'warn',
                action: 'recover-media',
                details: info.details,
                contentType,
                title: titleRef.current,
                currentTime: currentPlaybackTime(),
                url: info.url || streamUrlRef.current || undefined,
              });
              try {
                hlsInstance.recoverMediaError();
                return;
              } catch (e) {
                handledFatalAtRef.current = 0;
                console.error('[VideoPlayer] recoverMediaError() failed, falling back to remount', e);
              }
            }
          });
        });
      }
    },
    [contentType, currentPlaybackTime, triggerUrlRefresh]
  );

  const handleError = useCallback(
    async (event: any) => {
      if (isRetrying.current || refreshInFlightRef.current) return;

      // Vidstack's internal hlsError listener fires before ours on the same tick;
      // yield a microtask so our hlsError listener logs details and starts any
      // in-place recovery or VOD 403 URL refresh before we decide to remount.
      await Promise.resolve();
      if (!mountedRef.current || isRetrying.current || refreshInFlightRef.current) return;
      if (Date.now() - handledFatalAtRef.current < 150) return;

      const error = event?.detail || event?.error || playerRef.current?.error || playerRef.current?.state?.error;
      const playerErr = extractPlayerErrorInfo(error);
      const recentHls =
        lastHlsErrorRef.current && Date.now() - lastHlsErrorRef.current.at < 2000
          ? lastHlsErrorRef.current
          : null;

      let status = playerErr.status ?? recentHls?.status ?? null;
      hadErrorsRef.current = true;

      logConnectionEvent({
        source: 'player',
        event: 'player-error',
        level: 'error',
        status,
        details: recentHls?.details,
        reason: playerErr.message,
        url: recentHls?.url || streamUrlRef.current || undefined,
        title: titleRef.current,
        contentType,
        currentTime: currentPlaybackTime(),
        retryCount: retryCountRef.current,
      });

      // Progressive (non-HLS) VOD errors don't carry an HTTP status on MediaError.
      // Probe one byte so expired/403 progressive links refresh cleanly instead of
      // failing out on code 4 or remounting the same dead token.
      if (
        contentType !== 'tv' &&
        status === null &&
        !hlsInstanceRef.current &&
        streamUrlRef.current &&
        onRefreshRef.current
      ) {
        try {
          const probe = await authFetch(streamUrlRef.current, {
            method: 'GET',
            headers: { Range: 'bytes=0-0' },
            signal: AbortSignal.timeout(3000),
          });
          try {
            void probe.body?.cancel?.();
          } catch {
            // Ignore cancel errors.
          }
          if (!mountedRef.current || isRetrying.current || refreshInFlightRef.current) return;
          if (probe.status >= 400) {
            status = probe.status;
          }
        } catch {
          // Network unreachable or timed out — continue to normal retry path.
        }
      }

      if (contentType !== 'tv' && isRefreshableHttpStatus(status) && onRefreshRef.current) {
        if (refreshCountRef.current < MAX_URL_REFRESHES) {
          void triggerUrlRefresh(status, urlRefreshDelayMs(refreshCountRef.current), 'player-error');
          return;
        }
        logConnectionEvent({
          source: 'player',
          event: 'stream-recovery',
          level: 'error',
          action: 'give-up',
          status,
          retryCount: refreshCountRef.current,
          reason: 'refresh-limit-reached',
          contentType,
          title: titleRef.current,
          currentTime: currentPlaybackTime(),
          url: streamUrlRef.current || undefined,
        });
        setIsRecovering(false);
        toast.error(`Stream access rejected by provider (${status}). Please try again shortly.`);
        return;
      }

      let is404 = status === 404 || playerErr.code === 4;

      if (!is404 && contentType === 'tv' && !networkRecoveryAttempted.current && hlsInstanceRef.current) {
        networkRecoveryAttempted.current = true;
        logConnectionEvent({
          source: 'player',
          event: 'stream-recovery',
          level: 'warn',
          action: 'start-load',
          status,
          contentType,
          title: titleRef.current,
          url: streamUrlRef.current || undefined,
        });
        try {
          hlsInstanceRef.current.startLoad();
          return;
        } catch (e) {
          console.error('[VideoPlayer] startLoad() recovery failed, continuing to remount path', e);
        }
      }

      // Check stream URL status directly if we suspect a network/resource error on Live TV
      if (!is404 && streamUrlRef.current && contentType === 'tv') {
        try {
          const response = await authFetch(streamUrlRef.current, { method: 'HEAD' });
          if (response.status === 404) {
            is404 = true;
          }
        } catch {
          try {
            const response = await authFetch(streamUrlRef.current, { signal: AbortSignal.timeout(2000) });
            if (response.status === 404) {
              is404 = true;
            }
          } catch (err) {
            console.error('[VideoPlayer] Fetch check for 404 failed:', err);
          }
        }
        if (!mountedRef.current || isRetrying.current || refreshInFlightRef.current) return;
      }

      if (is404) {
        if (contentType === 'tv') {
          setStreamError('Channel is not available 404 status');
          setIsRecovering(false);
          logConnectionEvent({
            source: 'player',
            event: 'stream-recovery',
            level: 'error',
            action: 'give-up',
            status: 404,
            reason: 'channel-not-found',
            contentType,
            title: titleRef.current,
            url: streamUrlRef.current || undefined,
          });
          return;
        }
      }

      if (playerErr.code === 4 || status === 500) {
        logConnectionEvent({
          source: 'player',
          event: 'stream-recovery',
          level: 'error',
          action: 'give-up',
          status: status ?? playerErr.code,
          reason: playerErr.message || 'unrecoverable-media-error',
          contentType,
          title: titleRef.current,
          currentTime: currentPlaybackTime(),
          url: streamUrlRef.current || undefined,
        });
        toast.error('Stream error. Please try another source.');
        return;
      }

      const currentRetries = retryCountRef.current;
      if (currentRetries < 10) {
        const nextRetry = currentRetries + 1;
        const delayMs = Math.min(1000 * Math.pow(2, currentRetries), 5000);
        isRetrying.current = true;
        setIsRecovering(true);
        logConnectionEvent({
          source: 'player',
          event: 'stream-recovery',
          level: 'warn',
          action: 'remount',
          status,
          retryCount: nextRetry,
          contentType,
          title: titleRef.current,
          currentTime: currentPlaybackTime(),
          url: streamUrlRef.current || undefined,
        });
        clearRetryTimer();
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (!mountedRef.current) return;
          setRetryCount((prev) => prev + 1);
          setReloadTrigger((prev) => prev + 1);
          setIsRecovering(false);
          isRetrying.current = false;
        }, delayMs);
      } else {
        logConnectionEvent({
          source: 'player',
          event: 'stream-recovery',
          level: 'error',
          action: 'give-up',
          status,
          retryCount: currentRetries,
          reason: 'max-retries-reached',
          contentType,
          title: titleRef.current,
          currentTime: currentPlaybackTime(),
          url: streamUrlRef.current || undefined,
        });
        toast.error('Failed to load stream after multiple attempts');
        setIsRecovering(false);
      }
    },
    [clearRetryTimer, contentType, currentPlaybackTime, playerRef, triggerUrlRefresh]
  );

  return {
    retryCount,
    reloadTrigger,
    isRecovering,
    streamError,
    setStreamError,
    setRetryCount,
    setReloadTrigger,
    resetRecoveryState,
    markPlaybackRecovered,
    onProviderChange,
    handleError,
  };
}
