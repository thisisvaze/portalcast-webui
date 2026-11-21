import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONNECTION_LOG_STORAGE_KEY,
  createConnectionLogger,
  formatConnectionLogEntry,
  sanitizeStreamUrl,
} from '../src/utils/connectionLog.ts';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test('sanitizeStreamUrl truncates tokens, strips origins/credentials and keeps stream flags', () => {
  assert.equal(
    sanitizeStreamUrl(
      'http://127.0.0.1:5173/api/proxy?t=94f26e36796ce6cfed132d4208ce1e0c&m3u8=1'
    ),
    '/api/proxy?t=94f26e36...&m3u8=1'
  );
  assert.equal(
    sanitizeStreamUrl('/api/proxy/stream?t=520a3e4cf95e30162eeda74ed0410407'),
    '/api/proxy/stream?t=520a3e4c...'
  );
  assert.equal(
    sanitizeStreamUrl(
      'https://user:secret@stream.example.com/live.m3u8?t=abcdef1234567890&id=42&secret=hide'
    ),
    '/live.m3u8?t=abcdef12...&id=42'
  );
  assert.equal(sanitizeStreamUrl(undefined), undefined);
});

test('connection logger persists bounded ring buffer and emits concise formatted lines', () => {
  const storage = memoryStorage();
  const emitted = [];
  const logger = createConnectionLogger({
    storage,
    maxEntries: 3,
    emitConsole: (level, line) => emitted.push({ level, line }),
  });

  logger.log({
    source: 'player',
    event: 'hls-error',
    level: 'warn',
    status: 403,
    fatal: false,
    details: 'fragLoadError',
    url: '/api/proxy/stream?t=520a3e4cf95e30162eeda74ed0410407',
    title: 'The Odyssey',
    contentType: 'movie',
    currentTime: 1423.4,
    ts: '2026-11-21T17:00:00.000Z',
  });
  logger.log({
    source: 'socket',
    event: 'socket-disconnect',
    level: 'warn',
    reason: 'transport close',
    retryCount: 1,
    ts: '2026-11-21T17:00:01.000Z',
  });
  logger.log({
    source: 'socket',
    event: 'socket-reconnect',
    level: 'info',
    downtimeMs: 850,
    retryCount: 1,
    ts: '2026-11-21T17:00:02.000Z',
  });
  logger.log({
    source: 'player',
    event: 'stream-recovery',
    level: 'info',
    action: 'recovered',
    ts: '2026-11-21T17:00:03.000Z',
  });

  const entries = logger.get();
  assert.equal(entries.length, 3);
  assert.equal(entries[0].event, 'socket-disconnect');
  assert.equal(entries[2].action, 'recovered');

  assert.match(
    emitted[0].line,
    /\[connection\] hls-error status=403 fatal=false details=fragLoadError at=1423s kind=movie title="The Odyssey" url=\/api\/proxy\/stream\?t=520a3e4c\.\.\./
  );
  assert.match(formatConnectionLogEntry(entries[1]), /downtime=850ms/);

  // Survives reload via storage
  const persisted = JSON.parse(storage.getItem(CONNECTION_LOG_STORAGE_KEY));
  assert.equal(persisted.length, 3);

  const reloaded = createConnectionLogger({
    storage,
    maxEntries: 3,
    emitConsole: () => {},
  });
  assert.equal(reloaded.get(2).length, 2);
  assert.match(reloaded.summary(2), /socket-reconnect/);

  reloaded.clear();
  assert.equal(reloaded.get().length, 0);
  assert.equal(storage.getItem(CONNECTION_LOG_STORAGE_KEY), null);
});
