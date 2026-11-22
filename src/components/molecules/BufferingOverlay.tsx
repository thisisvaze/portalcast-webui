import React from 'react';
import { useMediaState } from '@vidstack/react';
import { useVideoContext } from '@/context/video';
import ActivityIndicator from '@/components/ui/ActivityIndicator';

export const BufferingOverlay = React.memo(({ hidden = false }: { hidden?: boolean }) => {
  const { playerRef } = useVideoContext();
  const isBuffering = useMediaState('waiting', playerRef);
  if (hidden || !isBuffering) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/35 backdrop-blur-xs">
        <ActivityIndicator className="text-lg text-white/85" />
      </div>
    </div>
  );
});

BufferingOverlay.displayName = 'BufferingOverlay';
