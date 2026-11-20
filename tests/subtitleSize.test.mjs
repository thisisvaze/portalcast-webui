import assert from 'node:assert/strict';
import test from 'node:test';
import { savedSubtitleSize, subtitleSizeKey, subtitleSizes } from '../src/utils/subtitleSize.ts';

test('subtitle size restores a supported choice and defaults to medium', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => storage.get(key) } });
  assert.equal(savedSubtitleSize(), 'medium');
  storage.set(subtitleSizeKey, 'obsolete');
  assert.equal(savedSubtitleSize(), 'medium');
  for (const size of subtitleSizes) {
    storage.set(subtitleSizeKey, size);
    assert.equal(savedSubtitleSize(), size);
  }
});
