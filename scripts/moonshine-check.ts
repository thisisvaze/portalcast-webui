// Check for src/utils/liveCaptions/moonshine.ts on real speech, streamed as the player streams it:
//   node --experimental-strip-types scripts/moonshine-check.ts <model dir> <16 kHz mono 16-bit wav> [expected words]
// <model dir>: frontend.onnx encoder.onnx adapter.onnx cross_kv.onnx decoder_kv.onnx streaming_config.json
// tokenizer.json from huggingface.co/moonshine-ai/moonshine-streaming (onnx/medium).
// A clip: say -o /tmp/speech.wav --data-format=LEI16@16000 "Some words"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { MOONSHINE_FILES, loadMoonshine } from '../src/utils/liveCaptions/moonshine.ts';

const [dir, wav, expected = ''] = process.argv.slice(2);
if (process.env.THREADS) ort.env.wasm.numThreads = Number(process.env.THREADS); // the browser has 1 without cross-origin isolation
const bytes = (name: string) => new Uint8Array(readFileSync(`${dir}/${name}`));
const [frontend, encoder, adapter, cross_kv, decoder_kv] = MOONSHINE_FILES.map(bytes);
const model = await loadMoonshine(ort, {
  frontend,
  encoder,
  adapter,
  cross_kv,
  decoder_kv,
  config: JSON.parse(readFileSync(`${dir}/streaming_config.json`, 'utf8')),
  vocab: JSON.parse(readFileSync(`${dir}/tokenizer.json`, 'utf8')).model.vocab,
}, {}, process.env.CONTEXT ? Number(process.env.CONTEXT) : undefined);

const file = readFileSync(wav);
const data = file.indexOf('data') + 8;
const pcm = new Int16Array(file.buffer.slice(file.byteOffset + data, file.byteOffset + file.length - ((file.length - data) % 2)));
const audio = Float32Array.from(pcm, (s) => s / 32768);

const stream = model.stream();
let since = 0;
for (let at = 0; at < audio.length; at += 512) {
  const frame = audio.subarray(at, at + 512);
  const t0 = performance.now();
  await stream.add(frame);
  since += frame.length;
  if (since >= 8000) {
    since = 0;
    const text = await stream.read(false);
    console.log(`${(at / 16000).toFixed(1)}s partial (${Math.round(performance.now() - t0)} ms): ${text}`);
  }
}
const t0 = performance.now();
const text = await stream.read(true);
console.log(`final (${Math.round(performance.now() - t0)} ms): ${text}`);
for (const word of expected.toLowerCase().split(/\s+/).filter(Boolean)) assert.ok(text.toLowerCase().includes(word), `missing "${word}"`);
console.log('moonshine: all checks passed');
