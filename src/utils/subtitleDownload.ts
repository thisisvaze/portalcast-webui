import { getBaseUrl } from '@/api/config';
import { authFetch } from '@/api/client';
import { subtitleVtt } from './subtitleVtt';

export interface OnlineSubtitleRef {
  fileId: number;
  downloadId?: string;
  source?: string;
}

/** What a pick that did not download says (the same words as the TV app). */
export function subtitleFailureText(result: OnlineSubtitleRef): string {
  return result.source === 'opensubtitles' || (!result.downloadId && result.fileId)
    ? "OpenSubtitles didn't send that file. Try another one."
    : "That subtitle didn't load. Try another one.";
}

/** The address of an online subtitle (the server's download, as WebVTT). */
export function subtitleDownloadUrl(result: OnlineSubtitleRef): string {
  // New servers read `id` (OpenSubtitles or SubDL); older ones only `fileId`.
  const id = result.downloadId || `os:${result.fileId}`;
  const query = new URLSearchParams({ id });
  if (result.fileId) query.set('fileId', String(result.fileId));
  return `${getBaseUrl()}/v2/subtitles/download?${query.toString()}`;
}

/** The track element cannot send the viewer's bearer token. Hand it the file from this request. */
export async function downloadSubtitle(result: OnlineSubtitleRef, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await authFetch(subtitleDownloadUrl(result), { signal });
    return res.ok ? await subtitleVtt(await res.text()) : null;
  } catch {
    return null;
  }
}
