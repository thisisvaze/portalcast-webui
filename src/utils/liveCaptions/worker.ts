/// <reference lib="webworker" />
// Live captions, in the browser (index.ts starts it): Silero VAD finds speech, Moonshine (English)
// writes it down. Adapted from Hugging Face's moonshine-web example
// (github.com/huggingface/transformers.js-examples), made live: while someone speaks, the piece so
// far is read again about once a second ('partial', words appear as they are said), and at a pause
// (or 6 s) it is read a last time ('final').
//
// In:  { buffer: Float32Array } (16 kHz mono, 512 samples)
// Out: { type: 'status', status: 'loading' | 'ready', device }
//      { type: 'text', text, final }   (a partial replaces the line being written; a final settles it)
//      { type: 'stats', kind, seconds, ms, text }   (for the console)
//      { type: 'error', message }
import { AutoModel, Tensor, pipeline } from '@huggingface/transformers';

const SAMPLE_RATE = 16000;
const PER_MS = SAMPLE_RATE / 1000;
const SPEECH_THRESHOLD = 0.3; // above: speech
const EXIT_THRESHOLD = 0.1; // while speaking, below this: not speech any more
const MIN_SILENCE = 300 * PER_MS; // a pause this long ends a piece
const SPEECH_PAD = 80 * PER_MS; // kept before a piece
const MIN_SPEECH = 250 * PER_MS; // shorter pieces are dropped
const MAX_PIECE = 6 * SAMPLE_RATE; // cut here even without a pause (commentary rarely pauses)
const PARTIAL_EVERY = 0.8 * SAMPLE_RATE; // read the piece so far again after this much more audio
const PREV_BUFFERS = Math.ceil(SPEECH_PAD / 512);

const post = (message: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

async function load() {
  let device: 'webgpu' | 'wasm' = 'wasm';
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) device = 'webgpu';
  } catch {
    /* no WebGPU: the CPU (WebAssembly) */
  }
  post({ type: 'status', status: 'loading', device });
  const vad = await AutoModel.from_pretrained('onnx-community/silero-vad', { config: { model_type: 'custom' } as never, dtype: 'fp32' });
  const transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/moonshine-base-ONNX', {
    device,
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'fp32', decoder_model_merged: 'q8' },
  });
  await transcriber(new Float32Array(SAMPLE_RATE)); // compiles the GPU shaders before the first piece
  post({ type: 'status', status: 'ready', device });
  return { vad, transcriber };
}

const models = load().catch((e: unknown) => {
  post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  throw e;
});

// Transformers.js runs one inference at a time: every call goes through this chain.
let chain: Promise<unknown> = Promise.resolve();
const queue = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn);
  chain = next.catch(() => undefined);
  return next;
};

const sr = new Tensor('int64', [SAMPLE_RATE], []);
let vadState = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
const piece = new Float32Array(MAX_PIECE);
let length = 0;
let speaking = false;
let silence = 0;
let prev: Float32Array[] = [];
let sinceRead = 0; // samples added since the piece was last read
let reading = false; // a partial read in flight (never two at once: they would pile up)
let pieceId = 0; // a partial from an earlier piece is dropped

async function isSpeech(buffer: Float32Array): Promise<boolean> {
  const { vad } = await models;
  const input = new Tensor('float32', buffer, [1, buffer.length]);
  const { stateN, output } = await queue(() => vad({ input, sr, state: vadState }) as Promise<{ stateN: Tensor; output: Tensor }>);
  vadState = stateN;
  const p = (output.data as Float32Array)[0];
  return p > SPEECH_THRESHOLD || (speaking && p >= EXIT_THRESHOLD);
}

/** The piece so far, with a little audio from just before it (so the first word is whole). */
function audioSoFar(): Float32Array {
  const before = prev.reduce((n, b) => n + b.length, 0);
  const audio = new Float32Array(before + length);
  let at = 0;
  for (const b of prev) {
    audio.set(b, at);
    at += b.length;
  }
  audio.set(piece.subarray(0, length), at);
  return audio;
}

async function read(audio: Float32Array, final: boolean, id: number) {
  const { transcriber } = await models;
  const t0 = performance.now();
  const out = (await queue(() => transcriber(audio) as Promise<{ text: string } | { text: string }[]>)) as { text: string } | { text: string }[];
  const text = (Array.isArray(out) ? out[0]?.text : out.text)?.trim() ?? '';
  post({ type: 'stats', kind: final ? 'final' : 'partial', seconds: +(audio.length / SAMPLE_RATE).toFixed(2), ms: Math.round(performance.now() - t0), text });
  if (!final && id !== pieceId) return; // the piece already ended: its final says it
  if (text) post({ type: 'text', text, final });
}

function finish() {
  const audio = audioSoFar();
  const id = pieceId;
  pieceId++;
  void read(audio, true, id);
  length = 0;
  speaking = false;
  silence = 0;
  sinceRead = 0;
  prev = [];
}

self.onmessage = async (event: MessageEvent<{ buffer: Float32Array }>) => {
  const { buffer } = event.data;
  const wasSpeaking = speaking;
  const speech = await isSpeech(buffer);

  if (!wasSpeaking && !speech) {
    if (prev.length >= PREV_BUFFERS) prev.shift();
    prev.push(buffer);
    return;
  }

  const room = MAX_PIECE - length;
  if (buffer.length >= room) {
    piece.set(buffer.subarray(0, room), length);
    length += room;
    finish();
    const rest = buffer.subarray(room);
    piece.set(rest, 0);
    length = rest.length;
    speaking = speech;
    return;
  }
  piece.set(buffer, length);
  length += buffer.length;
  sinceRead += buffer.length;

  if (speech) {
    speaking = true;
    silence = 0;
    // Words as they are said: read the piece so far again, one read at a time.
    if (sinceRead >= PARTIAL_EVERY && !reading && length >= MIN_SPEECH) {
      sinceRead = 0;
      reading = true;
      void read(audioSoFar(), false, pieceId).finally(() => {
        reading = false;
      });
    }
    return;
  }
  silence += buffer.length;
  if (silence < MIN_SILENCE) return; // a breath, not the end
  if (length < MIN_SPEECH + silence) {
    length = 0;
    speaking = false;
    silence = 0;
    sinceRead = 0;
    return;
  }
  finish();
};
