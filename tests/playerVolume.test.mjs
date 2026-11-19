import assert from 'node:assert/strict';
import test from 'node:test';
import { initialPlayerVolume } from '../src/utils/playerVolume.ts';

test('cast volume, including zero, takes precedence over device and account defaults', () => {
  const stored = new Map([['viewer', '{"volume":0.9,"muted":true}']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => stored.get(key) ?? null } });
  const account = { volume: 0.25, muted: false };
  assert.deepEqual(initialPlayerVolume('viewer', { volume: 0, muted: false }, account), { volume: 0, muted: false });
  assert.deepEqual(initialPlayerVolume('viewer', undefined, account), { volume: 0.9, muted: true });
  assert.deepEqual(initialPlayerVolume('other', undefined, account), account);
  stored.set('viewer', '{"volume":2,"muted":"false"}');
  assert.deepEqual(initialPlayerVolume('viewer', undefined, account), account);
  stored.set('viewer', '{');
  assert.deepEqual(initialPlayerVolume('viewer'), { volume: 1, muted: false });
});
