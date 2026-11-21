export const CONSECUTIVE_FORBIDDEN_THRESHOLD = 2;
export const MAX_URL_REFRESHES = 3;
export const URL_REFRESH_DELAYS_MS = [0, 2000, 4000] as const;

export interface HlsErrorInfo {
  type?: string;
  details?: string;
  fatal: boolean;
  status: number | null;
  url?: string;
  reason?: string;
}

export interface PlayerErrorInfo {
  code?: number;
  status: number | null;
  message?: string;
}

export interface HlsErrorDecisionInput {
  contentType: 'movie' | 'series' | 'tv';
  type?: string;
  fatal: boolean;
  status: number | null;
  consecutiveForbidden: number;
  canRefreshUrl: boolean;
  refreshCount: number;
  networkRecoveryAttempted: boolean;
  mediaErrorRecoveryAttempted: boolean;
}

export type HlsErrorAction =
  | { kind: 'ignore' }
  | { kind: 'not-found' }
  | { kind: 'refresh-url'; delayMs: number }
  | { kind: 'forbidden-exhausted' }
  | { kind: 'start-load' }
  | { kind: 'recover-media' }
  | { kind: 'fallback-handle-error' };

export function isRefreshableHttpStatus(
  status: number | null | undefined
): boolean {
  return status === 401 || status === 403;
}

export function urlRefreshDelayMs(refreshCount: number): number {
  const index = Math.min(
    Math.max(0, refreshCount),
    URL_REFRESH_DELAYS_MS.length - 1
  );
  return URL_REFRESH_DELAYS_MS[index];
}

function validHttpStatus(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
}

export function extractStatusFromText(text?: string | null): number | null {
  if (!text) return null;
  const labeled = text.match(/\b(?:status|http|code)[\s:=]+(4\d\d|5\d\d)\b/i);
  if (labeled) return validHttpStatus(labeled[1]);
  const known = text.match(/\b(401|403|404|410|429|500|502|503|504)\b/);
  if (known) return validHttpStatus(known[1]);
  return null;
}

export function extractHlsErrorInfo(data: unknown): HlsErrorInfo {
  const d = (data && typeof data === 'object' ? data : {}) as Record<
    string,
    unknown
  >;
  const response = (
    d.response && typeof d.response === 'object' ? d.response : undefined
  ) as Record<string, unknown> | undefined;
  const networkDetails = (
    d.networkDetails && typeof d.networkDetails === 'object'
      ? d.networkDetails
      : undefined
  ) as Record<string, unknown> | undefined;
  const frag = (d.frag && typeof d.frag === 'object' ? d.frag : undefined) as
    Record<string, unknown> | undefined;
  const context = (
    d.context && typeof d.context === 'object' ? d.context : undefined
  ) as Record<string, unknown> | undefined;
  const errObj = (
    d.error && typeof d.error === 'object' ? d.error : undefined
  ) as Record<string, unknown> | undefined;

  const type = typeof d.type === 'string' ? d.type : undefined;
  const details = typeof d.details === 'string' ? d.details : undefined;
  const reason =
    typeof d.reason === 'string'
      ? d.reason
      : typeof errObj?.message === 'string'
        ? errObj.message
        : undefined;
  const fatal = Boolean(d.fatal);

  const status =
    validHttpStatus(response?.code) ??
    validHttpStatus(response?.status) ??
    validHttpStatus(networkDetails?.status) ??
    extractStatusFromText(reason) ??
    extractStatusFromText(details);

  const url =
    (typeof response?.url === 'string' && response.url) ||
    (typeof frag?.url === 'string' && frag.url) ||
    (typeof context?.url === 'string' && context.url) ||
    (typeof d.url === 'string' && d.url) ||
    undefined;

  return { type, details, fatal, status, url, reason };
}

export function extractPlayerErrorInfo(error: unknown): PlayerErrorInfo {
  if (!error) return { status: null };
  if (typeof error === 'string') {
    return { status: extractStatusFromText(error), message: error };
  }
  if (typeof error !== 'object') return { status: null };
  const e = error as Record<string, unknown>;
  const nested = (
    e.error && typeof e.error === 'object' ? e.error : undefined
  ) as Record<string, unknown> | undefined;
  const code = typeof e.code === 'number' ? e.code : undefined;
  const message =
    typeof e.message === 'string'
      ? e.message
      : typeof nested?.message === 'string'
        ? nested.message
        : undefined;
  const status =
    validHttpStatus(e.status) ??
    extractStatusFromText(message) ??
    extractStatusFromText(String(error));

  return { code, status, message };
}

/**
 * Decides how the player should react to an hls.js error event.
 * - On VOD (movie/series), HTTP 401/403 usually means an expired or rejected upstream
 *   stream link: after two consecutive non-fatal hits (or any fatal hit), re-resolve a
 *   fresh link instead of hammering the same dead token through 10 retries + remounts.
 * - On Live TV, the server refreshes upstream 403s itself; keep TV's existing 404 and
 *   in-place startLoad()/recoverMediaError() recovery path.
 */
export function decideHlsErrorAction(
  input: HlsErrorDecisionInput
): HlsErrorAction {
  const {
    contentType,
    type,
    fatal,
    status,
    consecutiveForbidden,
    canRefreshUrl,
    refreshCount,
    networkRecoveryAttempted,
    mediaErrorRecoveryAttempted,
  } = input;

  if (fatal && status === 404 && contentType === 'tv') {
    return { kind: 'not-found' };
  }

  if (contentType !== 'tv' && isRefreshableHttpStatus(status)) {
    if (!fatal && consecutiveForbidden < CONSECUTIVE_FORBIDDEN_THRESHOLD) {
      return { kind: 'ignore' };
    }
    if (canRefreshUrl) {
      if (refreshCount < MAX_URL_REFRESHES) {
        return {
          kind: 'refresh-url',
          delayMs: urlRefreshDelayMs(refreshCount),
        };
      }
      return { kind: 'forbidden-exhausted' };
    }
    return fatal ? { kind: 'fallback-handle-error' } : { kind: 'ignore' };
  }

  if (!fatal) return { kind: 'ignore' };

  if (type === 'networkError' && !networkRecoveryAttempted) {
    return { kind: 'start-load' };
  }
  if (type === 'mediaError' && !mediaErrorRecoveryAttempted) {
    return { kind: 'recover-media' };
  }
  return { kind: 'fallback-handle-error' };
}
