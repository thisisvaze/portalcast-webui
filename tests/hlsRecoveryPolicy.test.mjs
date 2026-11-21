import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSECUTIVE_FORBIDDEN_THRESHOLD,
  MAX_URL_REFRESHES,
  decideHlsErrorAction,
  extractHlsErrorInfo,
  extractPlayerErrorInfo,
  extractStatusFromText,
  urlRefreshDelayMs,
} from '../src/utils/hlsRecoveryPolicy.ts';

test('extractHlsErrorInfo reads HTTP status and URL from hls.js error data', () => {
  const info = extractHlsErrorInfo({
    type: 'networkError',
    details: 'fragLoadError',
    fatal: false,
    response: {
      code: 403,
      url: 'http://127.0.0.1:5173/api/proxy/stream?t=520a3e4cf95e30162eeda74ed0410407',
    },
    error: new Error(
      'A network error (status 403) occurred while loading segment'
    ),
  });
  assert.equal(info.status, 403);
  assert.equal(info.fatal, false);
  assert.equal(info.details, 'fragLoadError');
  assert.match(info.url, /\/api\/proxy\/stream\?t=520a3e4c/);
});

test('extractStatusFromText avoids matching resolutions or random token digits', () => {
  assert.equal(
    extractStatusFromText('A network error (status 403) occurred'),
    403
  );
  assert.equal(extractStatusFromText('HTTP 502 Bad Gateway'), 502);
  assert.equal(extractStatusFromText('Video 1080p stream t=403abc'), null);
  assert.equal(
    extractPlayerErrorInfo({
      code: 4,
      message: 'Server returned 403 Forbidden',
    }).status,
    403
  );
});

test('VOD refreshes the stream URL after two consecutive non-fatal 403s or any fatal 403/401', () => {
  const base = {
    contentType: 'movie',
    type: 'networkError',
    status: 403,
    canRefreshUrl: true,
    refreshCount: 0,
    networkRecoveryAttempted: false,
    mediaErrorRecoveryAttempted: false,
  };

  // First non-fatal 403 lets hls.js do one quick retry.
  assert.deepEqual(
    decideHlsErrorAction({ ...base, fatal: false, consecutiveForbidden: 1 }),
    { kind: 'ignore' }
  );

  // Second consecutive non-fatal 403 refreshes immediately instead of waiting through 10 retries.
  assert.deepEqual(
    decideHlsErrorAction({
      ...base,
      fatal: false,
      consecutiveForbidden: CONSECUTIVE_FORBIDDEN_THRESHOLD,
    }),
    { kind: 'refresh-url', delayMs: 0 }
  );

  // Fatal 401/403 triggers refresh immediately even on first occurrence, with backoff on retries.
  assert.deepEqual(
    decideHlsErrorAction({
      ...base,
      status: 401,
      fatal: true,
      consecutiveForbidden: 1,
      refreshCount: 1,
    }),
    { kind: 'refresh-url', delayMs: urlRefreshDelayMs(1) }
  );

  // Exhausted refresh budget stops the loop cleanly.
  assert.deepEqual(
    decideHlsErrorAction({
      ...base,
      fatal: true,
      consecutiveForbidden: 1,
      refreshCount: MAX_URL_REFRESHES,
    }),
    { kind: 'forbidden-exhausted' }
  );
});

test('Live TV keeps its 404 screen and in-place network recovery path', () => {
  assert.deepEqual(
    decideHlsErrorAction({
      contentType: 'tv',
      type: 'networkError',
      fatal: true,
      status: 404,
      consecutiveForbidden: 0,
      canRefreshUrl: false,
      refreshCount: 0,
      networkRecoveryAttempted: false,
      mediaErrorRecoveryAttempted: false,
    }),
    { kind: 'not-found' }
  );

  // First fatal non-404 network error tries startLoad once, second falls back to handleError remount.
  assert.deepEqual(
    decideHlsErrorAction({
      contentType: 'tv',
      type: 'networkError',
      fatal: true,
      status: 403,
      consecutiveForbidden: 2,
      canRefreshUrl: false,
      refreshCount: 0,
      networkRecoveryAttempted: false,
      mediaErrorRecoveryAttempted: false,
    }),
    { kind: 'start-load' }
  );

  assert.deepEqual(
    decideHlsErrorAction({
      contentType: 'tv',
      type: 'networkError',
      fatal: true,
      status: 502,
      consecutiveForbidden: 0,
      canRefreshUrl: false,
      refreshCount: 0,
      networkRecoveryAttempted: true,
      mediaErrorRecoveryAttempted: false,
    }),
    { kind: 'fallback-handle-error' }
  );
});
