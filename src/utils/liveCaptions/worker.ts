/// <reference lib="webworker" />
// Live captions, in the browser (index.ts starts it): Silero VAD cuts the audio at pauses and
// Moonshine (English) writes each piece down. Adapted from Hugging Face's moonshine-web example
// (github.com/huggingface/transformers.js-examples), with shorter pieces: commentary rarely
// pauses, and captions should keep coming.
//
// In:  { buffer: Float32Array } (16 kHz mono, 512 samples or more)
// Out: { type: 'status', status: 'loading' | 'ready', device } | { type: 'text', text } | { type: 'error', message }
import { AutoModel, Tensor, pipeline } from '@huggingface/transformers';

const SAMPLE_RATE = 16000;
const PER_MS = SAMPLE_RATE / 1000;
const SPEECH_THRESHOLD = 0.3; // above: speech
const EXIT_THRESHOLD = 0.1; // while speaking, below this: not speech any more
const MIN_SILENCE = 400 * PER_MS; // a pause this long ends a piece
const SPEECH_PAD = 80 * PER_MS; // kept before and after a piece
const MIN_SPEECH = 250 * PER_MS; // shorter pieces are dropped
const MAX_PIECE = 8 * SAMPLE_RATE; // cut here even without a pause
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

async function isSpeech(buffer: Float32Array): Promise<boolean> {
  const { vad } = await models;
  const input = new Tensor('float32', buffer, [1, buffer.length]);
  const { stateN, output } = await queue(() => vad({ input, sr, state: vadState }) as Promise<{ stateN: Tensor; output: Tensor }>);
  vadState = stateN;
  const p = (output.data as Float32Array)[0];
  return p > SPEECH_THRESHOLD || (speaking && p >= EXIT_THRESHOLD);
}

function send() {
  const before = prev.reduce((n, b) => n + b.length, 0);
  const audio = new Float32Array(before + length);
  let at = 0;
  for (const b of prev) {
    audio.set(b, at);
    at += b.length;
  }
  audio.set(piece.subarray(0, length), at);
  void models.then(({ transcriber }) =>
    queue(() => transcriber(audio) as Promise<{ text: string } | { text: string }[]>).then((out) => {
      const text = (Array.isArray(out) ? out[0]?.text : out.text)?.trim();
      if (text) post({ type: 'text', text });
    }),
  );
  length = 0;
  speaking = false;
  silence = 0;
  prev = [];
}

self.onmessage = async (event: MessageEvent<{ buffer: Float32Array }>) => {
  const { buffer } = event.data;
  const wasSpeaking = speaking;
  const speech = await isSpeech(buffer);

  if (!wasSpeaking && !speech) {
    // Not in a piece: keep a little audio from just before, so the first word is not clipped.
    if (prev.length >= PREV_BUFFERS) prev.shift();
    prev.push(buffer);
    return;
  }

  const room = MAX_PIECE - length;
  if (buffer.length >= room) {
    piece.set(buffer.subarray(0, room), length);
    length += room;
    send();
    const rest = buffer.subarray(room);
    piece.set(rest, 0);
    length = rest.length;
    speaking = speech;
    return;
  }
  piece.set(buffer, length);
  length += buffer.length;

  if (speech) {
    speaking = true;
    silence = 0;
    return;
  }
  silence += buffer.length;
  if (silence < MIN_SILENCE) return; // a breath, not the end
  if (length < MIN_SPEECH + silence) {
    length = 0;
    speaking = false;
    silence = 0;
    return;
  }
  send();
};
