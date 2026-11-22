export const LIVE_EDGE_TOLERANCE_SECONDS = 5;

export interface LiveEdgeInput {
  paused: boolean;
  currentTime: number;
  liveSyncPosition: number | null | undefined;
  /** True when a player without liveSyncPosition resumed after pausing. */
  resumedBehind?: boolean;
  toleranceSeconds?: number;
}

/**
 * True when a live broadcast is paused or has drifted past the live edge,
 * so the player should offer an actionable "Go Live" button instead of a passive "Live" badge.
 */
export function isBehindLiveEdge({
  paused,
  currentTime,
  liveSyncPosition,
  resumedBehind = false,
  toleranceSeconds = LIVE_EDGE_TOLERANCE_SECONDS,
}: LiveEdgeInput): boolean {
  if (paused) return true;
  if (
    liveSyncPosition != null &&
    Number.isFinite(liveSyncPosition) &&
    liveSyncPosition > 0 &&
    Number.isFinite(currentTime)
  ) {
    return liveSyncPosition - currentTime > toleranceSeconds;
  }
  return resumedBehind;
}
