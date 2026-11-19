/// <reference lib="webworker" />
// Live captions, in the browser (index.ts starts it): Silero VAD finds speech and a model writes it
// down: Whisper large-v3 turbo where the GPU can run it in half precision (far better on films and
// crowd noise), else Moonshine base (small and quick: phones, older machines, the CPU). Adapted from Hugging Face's moonshine-web example
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
const FIRST_PARTIAL = 1.2 * SAMPLE_RATE; // not before this much speech: shorter reads are guesses ("A")
const PREV_BUFFERS = Math.ceil(SPEECH_PAD / 512);

const post = (message: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

type Model = { id: string; label: string; size: string; whisper: boolean; dtype: Record<string, string> };
const WHISPER: Model = {
  id: 'onnx-community/whisper-large-v3-turbo',
  label: 'Whisper turbo',
  size: 'about 800 MB',
  whisper: true,
  dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
};
const moonshine = (gpu: boolean): Model => ({
  id: 'onnx-community/moonshine-base-ONNX',
  label: 'Moonshine',
  size: 'about 150 MB',
  whisper: false,
  dtype: { encoder_model: 'fp32', decoder_model_merged: gpu ? 'q4' : 'q8' },
});

async function load() {
  let device: 'webgpu' | 'wasm' = 'wasm';
  let halfFloats = false; // shader-f16: Whisper turbo's encoder runs in half precision
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    if (adapter) {
      device = 'webgpu';
      halfFloats = adapter.features.has('shader-f16');
    }
  } catch {
    /* no WebGPU: the CPU (WebAssembly) */
  }
  const model = device === 'webgpu' && halfFloats ? WHISPER : moonshine(device === 'webgpu');
  isWhisper = model.whisper;
  post({ type: 'status', status: 'loading', device, model: model.label, size: model.size });
  const vad = await AutoModel.from_pretrained('onnx-community/silero-vad', { config: { model_type: 'custom' } as never, dtype: 'fp32' });
  const transcriber = await pipeline('automatic-speech-recognition', model.id, { device, dtype: model.dtype as never });
  await transcriber(new Float32Array(SAMPLE_RATE), whisperOptions()); // compiles the GPU shaders before the first piece
  post({ type: 'status', status: 'ready', device, model: model.label });
  return { vad, transcriber };
}

let isWhisper = false;
// Whisper is told the language (English, as the menu says): left to guess, a few seconds of
// speech get a wrong one now and then.
const whisperOptions = () => (isWhisper ? { language: 'english', task: 'transcribe' } : {});
// What Whisper writes over music or silence (its training subtitles), not speech.
const INVENTED = /^\s*(?:\[[^\]]*\]|\([^)]*\)|♪+|thank you\.?|thanks for watching!?|you|bye\.?|subtitles by .*|\.+)\s*$/i;

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
  const out = (await queue(() => transcriber(audio, whisperOptions() as never) as Promise<{ text: string } | { text: string }[]>)) as { text: string } | { text: string }[];
  const raw = (Array.isArray(out) ? out[0]?.text : out.text)?.trim() ?? '';
  const text = INVENTED.test(raw) ? '' : raw;
  post({ type: 'stats', kind: final ? 'final' : 'partial', seconds: +(audio.length / SAMPLE_RATE).toFixed(2), ms: Math.round(performance.now() - t0), text });
  if (!final && id !== pieceId) return; // the piece already ended: its final says it
  // A letter or two on its own is noise read as speech, not a word.
  if ((text.match(/\p{L}/gu) ?? []).length >= 2) post({ type: 'text', text, final });
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
    if (sinceRead >= PARTIAL_EVERY && !reading && length >= FIRST_PARTIAL) {
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
