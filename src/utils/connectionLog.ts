export const CONNECTION_LOG_STORAGE_KEY = 'portalcast:connectionLog';
export const MAX_CONNECTION_LOG_ENTRIES = 200;

export type ConnectionEventKind =
  | 'hls-error'
  | 'player-error'
  | 'stream-recovery'
  | 'player-stalled'
  | 'socket-disconnect'
  | 'socket-reconnect'
  | 'socket-error'
  | 'network-offline'
  | 'network-online';

export interface ConnectionLogEntry {
  ts: string;
  source: 'player' | 'socket' | 'network';
  event: ConnectionEventKind;
  level: 'info' | 'warn' | 'error';
  status?: number | null;
  fatal?: boolean;
  action?: string;
  type?: string;
  details?: string;
  url?: string;
  title?: string;
  contentType?: 'movie' | 'series' | 'tv';
  currentTime?: number;
  retryCount?: number;
  downtimeMs?: number;
  reason?: string;
}

export type ConnectionLogInput = Omit<ConnectionLogEntry, 'ts'> & {
  ts?: string;
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEEP_QUERY_KEYS = new Set(['m3u8', 'id', 'play', 'proxy']);

/**
 * Strips origin/credentials and truncates opaque stream tokens to 8 chars so logs
 * distinguish stale vs refreshed tokens without storing full tokens or credentials.
 */
export function sanitizeStreamUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost';
    const parsed = new URL(raw, base);
    const kept = new URLSearchParams();
    const token = parsed.searchParams.get('t');
    if (token) {
      kept.set('t', token.length > 8 ? `${token.slice(0, 8)}...` : token);
    }
    for (const [k, v] of parsed.searchParams.entries()) {
      if (KEEP_QUERY_KEYS.has(k)) kept.set(k, v);
    }
    const qs = kept.toString();
    return qs ? `${parsed.pathname}?${qs}` : parsed.pathname;
  } catch {
    return raw
      .replace(/\/\/[^/@]+@/, '//')
      .split('?')[0]
      .slice(0, 120);
  }
}

export function formatConnectionLogEntry(entry: ConnectionLogEntry): string {
  const parts: string[] = [`[connection] ${entry.event}`];
  if (entry.action) parts.push(`action=${entry.action}`);
  if (entry.status != null) parts.push(`status=${entry.status}`);
  if (entry.fatal !== undefined) parts.push(`fatal=${entry.fatal}`);
  if (entry.type) parts.push(`type=${entry.type}`);
  if (entry.details) parts.push(`details=${entry.details}`);
  if (entry.reason) parts.push(`reason=${entry.reason}`);
  if (entry.retryCount != null) parts.push(`retry=${entry.retryCount}`);
  if (entry.downtimeMs != null) parts.push(`downtime=${entry.downtimeMs}ms`);
  if (entry.currentTime != null && Number.isFinite(entry.currentTime)) {
    parts.push(`at=${Math.round(entry.currentTime)}s`);
  }
  if (entry.contentType) parts.push(`kind=${entry.contentType}`);
  if (entry.title) parts.push(`title=${JSON.stringify(entry.title)}`);
  if (entry.url) parts.push(`url=${entry.url}`);
  return parts.join(' ');
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readPersisted(storage: StorageLike | null): ConnectionLogEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CONNECTION_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePersisted(
  storage: StorageLike | null,
  entries: ConnectionLogEntry[]
): void {
  if (!storage) return;
  try {
    storage.setItem(CONNECTION_LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage quota or private-mode errors.
  }
}

export interface ConnectionLogger {
  log(input: ConnectionLogInput): ConnectionLogEntry;
  get(limit?: number): ConnectionLogEntry[];
  clear(): void;
  summary(limit?: number): string;
}

export function createConnectionLogger(options?: {
  storage?: StorageLike | null;
  maxEntries?: number;
  emitConsole?: (
    level: ConnectionLogEntry['level'],
    line: string,
    entry: ConnectionLogEntry
  ) => void;
}): ConnectionLogger {
  const storage =
    options && 'storage' in options
      ? (options.storage ?? null)
      : defaultStorage();
  const maxEntries = options?.maxEntries ?? MAX_CONNECTION_LOG_ENTRIES;
  const emitConsole =
    options?.emitConsole ??
    ((level, line) => {
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.info(line);
    });

  let buffer: ConnectionLogEntry[] | null = null;
  const load = (): ConnectionLogEntry[] => {
    if (buffer === null) buffer = readPersisted(storage).slice(-maxEntries);
    return buffer;
  };

  const get = (limit?: number): ConnectionLogEntry[] => {
    const list = load();
    if (limit == null || limit >= list.length) return [...list];
    return list.slice(-Math.max(0, limit));
  };

  const clear = (): void => {
    buffer = [];
    try {
      storage?.removeItem(CONNECTION_LOG_STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  };

  const log = (input: ConnectionLogInput): ConnectionLogEntry => {
    const entry: ConnectionLogEntry = {
      ...input,
      ts: input.ts ?? new Date().toISOString(),
      url: input.url ? sanitizeStreamUrl(input.url) : undefined,
    };
    const list = load();
    list.push(entry);
    if (list.length > maxEntries) {
      list.splice(0, list.length - maxEntries);
    }
    writePersisted(storage, list);
    emitConsole(entry.level, formatConnectionLogEntry(entry), entry);
    return entry;
  };

  const summary = (limit = 50): string =>
    get(limit)
      .map((entry) => `${entry.ts} ${formatConnectionLogEntry(entry)}`)
      .join('\n');

  return { log, get, clear, summary };
}

const sharedLogger = createConnectionLogger();

export const logConnectionEvent = sharedLogger.log;
export const getConnectionLog = sharedLogger.get;
export const clearConnectionLog = sharedLogger.clear;
export const formatConnectionLogSummary = sharedLogger.summary;

declare global {
  interface Window {
    __pcConnectionLog?: {
      get: (limit?: number) => ConnectionLogEntry[];
      clear: () => void;
      summary: (limit?: number) => string;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__pcConnectionLog = {
    get: getConnectionLog,
    clear: clearConnectionLog,
    summary: formatConnectionLogSummary,
  };
}
