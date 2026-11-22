import assert from 'node:assert/strict';
import test from 'node:test';
import { isBehindLiveEdge } from '../src/utils/liveEdge.ts';

test('shows passive Live at the live edge and Go Live when paused or more than 5s behind', () => {
  assert.equal(
    isBehindLiveEdge({
      paused: false,
      currentTime: 120,
      liveSyncPosition: 122,
    }),
    false
  );
  assert.equal(
    isBehindLiveEdge({
      paused: false,
      currentTime: 117,
      liveSyncPosition: 122,
    }),
    false
  );
  assert.equal(
    isBehindLiveEdge({
      paused: false,
      currentTime: 116.5,
      liveSyncPosition: 122,
    }),
    true
  );
  assert.equal(
    isBehindLiveEdge({ paused: true, currentTime: 122, liveSyncPosition: 122 }),
    true
  );
});

test('falls back cleanly when liveSyncPosition is unavailable or infinite', () => {
  assert.equal(
    isBehindLiveEdge({
      paused: false,
      currentTime: 40,
      liveSyncPosition: null,
    }),
    false
  );
  assert.equal(
    isBehindLiveEdge({
      paused: false,
      currentTime: 40,
      liveSyncPosition: Infinity,
    }),
    false
  );
  assert.equal(
    isBehindLiveEdge({
      paused: false,
      currentTime: 40,
      liveSyncPosition: null,
      resumedBehind: true,
    }),
    true
  );
  assert.equal(
    isBehindLiveEdge({ paused: true, currentTime: 40, liveSyncPosition: null }),
    true
  );
});
