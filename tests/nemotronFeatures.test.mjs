import assert from 'node:assert/strict';
import test from 'node:test';
import { LogMelExtractor } from '../src/utils/liveCaptions/logMel.ts';
import { savedCaptionEngine } from '../src/utils/liveCaptions/preference.ts';

test('default and legacy Automatic use Nemotron, and an explicit Moonshine choice survives', () => {
  let stored = null;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored } });
  assert.equal(savedCaptionEngine(), 'nemotron');
  stored = 'auto';
  assert.equal(savedCaptionEngine(), 'nemotron');
  stored = 'moonshine';
  assert.equal(savedCaptionEngine(), 'moonshine');
});

test('Nemotron gets the same Kaldi features across audio packet boundaries', () => {
  const audio = Float32Array.from({ length: 8000 }, (_, i) =>
    0.5 * Math.sin(2 * Math.PI * 440 * i / 16000) + 0.1 * Math.sin(2 * Math.PI * 3000 * i / 16000));
  const frames = new LogMelExtractor().accept(audio);
  assert.equal(frames.length, 49);
  // kaldi-native-fbank reference for the reflected first frame and a steady-state frame.
  assert.ok(Math.abs(frames[0][20] + 0.8556) < 0.005);
  assert.ok(Math.abs(frames[10][18] - 0.8114) < 0.005);
  const streamed = new LogMelExtractor();
  const packets = [];
  for (let i = 0; i < audio.length; i += 512) packets.push(...streamed.accept(audio.subarray(i, i + 512)));
  assert.deepEqual(packets, frames);
});
