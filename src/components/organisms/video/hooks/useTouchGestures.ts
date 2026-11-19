/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, type RefObject } from 'react';
import type { useMediaRemote } from '@vidstack/react';
import { useVideoContext } from '@/context/video';

// Long-press-for-2x-speed + single/double-tap zone handling on the gesture
// overlay div. Kept separate from useTVRemoteNavigation since it's pointer
// input, not keyboard/remote — no shared state between the two beyond what
// both already get from VideoContext.
export function useTouchGestures(
  playerContainerRef: RefObject<HTMLDivElement | null>,
  speedBannerRef: RefObject<HTMLDivElement | null>,
  remote: ReturnType<typeof useMediaRemote>
) {
  const { playerRef, showControlsAndCursor, handleSkipButtonClick } =
    useVideoContext();

  const lastTouchTime = useRef(0);
  const longPressTimerRef = useRef<any>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapReleaseTimeRef = useRef<number>(0);
  const singleTapTimeoutRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (singleTapTimeoutRef.current) clearTimeout(singleTapTimeoutRef.current);
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    lastTouchTime.current = Date.now();

    const target = e.target as HTMLElement;
    if (target && (target.closest('button') || target.closest('.media-controls') || target.closest('.more-options-menu') || target.closest('.episode-overlay') || target.closest('.channel-list'))) {
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const touchX = touch.clientX;
      const touchY = touch.clientY;

      longPressTimerRef.current = setTimeout(() => {
        const player = playerRef.current;
        if (player) {
          player.playbackRate = 2.0;
          if (speedBannerRef.current) {
            speedBannerRef.current.style.display = 'flex';
          }
        }
      }, 500);

      touchStartPosRef.current = { x: touchX, y: touchY };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchDuration = Date.now() - lastTouchTime.current;
    lastTouchTime.current = Date.now(); // suppress the compatibility click, even after a hold
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    const player = playerRef.current;
    if (player && player.playbackRate === 2.0) {
      player.playbackRate = 1.0;
      if (speedBannerRef.current) {
        speedBannerRef.current.style.display = 'none';
      }
      e.preventDefault();
      return;
    }

    const target = e.target as HTMLElement;
    if (target && (target.closest('button') || target.closest('.media-controls') || target.closest('.more-options-menu') || target.closest('.episode-overlay') || target.closest('.channel-list'))) {
      return;
    }

    if (touchDuration < 300 && touchStartPosRef.current) {
      const changedTouch = e.changedTouches[0];
      const diffX = Math.abs(changedTouch.clientX - touchStartPosRef.current.x);
      const diffY = Math.abs(changedTouch.clientY - touchStartPosRef.current.y);

      if (diffX < 20 && diffY < 20) {
        const now = Date.now();
        const timeSinceLastTap = now - lastTapReleaseTimeRef.current;
        lastTapReleaseTimeRef.current = now;

        const bounds = playerContainerRef.current?.getBoundingClientRect();
        const ratio = (changedTouch.clientX - (bounds?.left ?? 0)) / (bounds?.width || window.innerWidth);

        if (timeSinceLastTap < 300) {
          lastTapReleaseTimeRef.current = 0;
          // Double Tap!
          if (singleTapTimeoutRef.current) {
            clearTimeout(singleTapTimeoutRef.current);
            singleTapTimeoutRef.current = null;
          }

          if (ratio < 0.3) {
            handleSkipButtonClick(-10);
          } else if (ratio > 0.7) {
            handleSkipButtonClick(10);
          } else {
            // Center double-tap → toggle fullscreen
            remote.toggleFullscreen();
          }
        } else {
          // Single Tap - Wait 300ms to see if it is a double tap
          if (singleTapTimeoutRef.current) {
            clearTimeout(singleTapTimeoutRef.current);
          }
          singleTapTimeoutRef.current = setTimeout(() => {
            remote.togglePaused();
            showControlsAndCursor();
            singleTapTimeoutRef.current = null;
          }, 300);
        }
      }
    }
  };

  return { handleTouchStart, handleTouchEnd, lastTouchTime };
}
