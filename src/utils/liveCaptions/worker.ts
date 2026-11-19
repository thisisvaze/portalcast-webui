/// <reference lib="webworker" />
// Live captions, in the browser (index.ts starts it): Silero VAD finds speech and Moonshine v2
// (moonshine.ts, English) writes it down as it is said, on the CPU (its graphs are 8-bit, which
// the GPU backend does not run). While someone speaks the piece so far is read again about twice
// a second ('partial'); at a pause (or past 6 s, a breath) it is read a last time ('final').
//
// In:  { buffer: Float32Array } (16 kHz mono, 512 samples)
// Out: { type: 'status', status: 'loading' | 'ready', device, model, size }
//      { type: 'text', text, final }   (a partial replaces the piece being written; a final settles it)
//      { type: 'stats', kind, seconds, ms, text }   (for the console)
//      { type: 'error', message }
import * as ort from 'onnxruntime-web/wasm';
import wasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { MOONSHINE_FILES, loadMoonshine } from './moonshine';

// Named for the runtime: in development Vite serves it from a folder that does not have the file.
ort.env.wasm.wasmPaths = { wasm };

const SAMPLE_RATE = 16000;
const PER_MS = SAMPLE_RATE / 1000;
const SPEECH_THRESHOLD = 0.3; // above: speech
const EXIT_THRESHOLD = 0.1; // while speaking, below this: not speech any more
const MIN_SILENCE = 300 * PER_MS; // a pause this long ends a piece
const SPEECH_PAD = 80 * PER_MS; // kept before a piece
const MIN_SPEECH = 250 * PER_MS; // shorter pieces are dropped
// Commentary rarely pauses for long: past LONG_PIECE a piece ends at the next breath (the voice
// detector dips below BREATH, as at a comma), at MAX_PIECE anyway. Cut inside a word, the word was
// lost or misread ("top 3" / "Corner"); between words not much better. Longer pieces read slower.
const LONG_PIECE = 6 * SAMPLE_RATE;
const BREATH = 0.5;
const MAX_PIECE = 10 * SAMPLE_RATE;
const PARTIAL_EVERY = 0.5 * SAMPLE_RATE; // read the piece so far again after this much more audio
// ... and after 1.5 times the audio the last reading took to make: back to back, readings keep
// the CPU from the audio, and the captions fall further and further behind.
const HEADROOM = 1.5;
const FIRST_PARTIAL = 1 * SAMPLE_RATE; // not before this much speech: shorter reads are guesses ("Mm-h")
const PREV_BUFFERS = Math.ceil(SPEECH_PAD / 512);

const MOONSHINE = 'https://huggingface.co/moonshine-ai/moonshine-streaming/resolve/main/onnx/medium/';
const SILERO = 'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx';

const post = (message: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

/** A model file, from the browser's cache after the first time. */
async function download(url: string): Promise<Response> {
  const cache = await caches.open('live-captions').catch(() => null);
  const cached = await cache?.match(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  await cache?.put(url, response.clone()).catch(() => undefined);
  return response;
}
const bytes = async (url: string) => new Uint8Array(await (await download(url)).arrayBuffer());

async function load() {
  post({ type: 'status', status: 'loading', device: 'wasm', model: 'Moonshine v2', size: 'about 300 MB' });
  const [vad, frontend, encoder, adapter, cross_kv, decoder_kv, config, tokenizer] = await Promise.all([
    bytes(SILERO).then((model) => ort.InferenceSession.create(model)),
    ...MOONSHINE_FILES.map((name) => bytes(MOONSHINE + name)),
    download(`${MOONSHINE}streaming_config.json`).then((r) => r.json()),
    download(`${MOONSHINE}tokenizer.json`).then((r) => r.json()),
  ]);
  // One thread unless the page is cross-origin isolated: then the encoder can afford its full context.
  const moonshine = await loadMoonshine(ort, { frontend, encoder, adapter, cross_kv, decoder_kv, config, vocab: tokenizer.model.vocab }, {}, self.crossOriginIsolated ? undefined : 32);
  post({ type: 'status', status: 'ready', device: 'wasm', model: 'Moonshine v2' });
  return { vad: vad as ort.InferenceSession, moonshine };
}

const models = load().catch((e: unknown) => {
  post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  throw e;
});

// One run at a time, in order: every call goes through this chain.
let chain: Promise<unknown> = Promise.resolve();
const queue = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn);
  chain = next.catch(() => undefined);
  return next;
};

type Piece = { add(audio: Float32Array): Promise<void>; read(final: boolean): Promise<string> };
const sr = new ort.Tensor('int64', BigInt64Array.of(BigInt(SAMPLE_RATE)), []);
let vadState: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
let piece: Piece | null = null; // the speech being written down
let length = 0;
let silence = 0;
let sinceRead = 0; // samples added since the piece was last read
let reading = false; // a partial read in flight (never two at once: they would pile up)
let lastReadMs = 0;
let prev: Float32Array[] = [];
let lastWords: string[] = []; // the piece's last partial reading

/** The voice detector's probability of speech in `buffer`, and whether it counts as speech. */
async function hear(buffer: Float32Array): Promise<{ p: number; speech: boolean }> {
  const { vad } = await models;
  const input = new ort.Tensor('float32', buffer, [1, buffer.length]);
  const { output, stateN } = await queue(() => vad.run({ input, sr, state: vadState }));
  vadState = stateN;
  const p = (output.data as Float32Array)[0];
  return { p, speech: p > SPEECH_THRESHOLD || (!!piece && p >= EXIT_THRESHOLD) };
}

const plain = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
/** The words this reading and the last agree on: the one being said is often a guess ("past 2022"). */
function agreed(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  let n = 0;
  while (n < words.length && n < lastWords.length && plain(words[n]) === plain(lastWords[n])) n++;
  lastWords = words;
  return words.slice(0, n).join(' ');
}

async function read(of: Piece, final: boolean) {
  const seconds = +(length / SAMPLE_RATE).toFixed(2);
  const t0 = performance.now();
  const text = await queue(() => of.read(final));
  lastReadMs = performance.now() - t0;
  post({ type: 'stats', kind: final ? 'final' : 'partial', seconds, ms: Math.round(performance.now() - t0), text });
  if (!final && of !== piece) return; // the piece already ended: its final says it
  const shown = final ? text : agreed(text);
  // A letter or two on its own is noise read as speech, not a word.
  if ((shown.match(/\p{L}/gu) ?? []).length >= 2) post({ type: 'text', text: shown, final });
}

function end(keep: boolean) {
  if (piece && keep) void read(piece, true);
  piece = null;
  length = 0;
  silence = 0;
  sinceRead = 0;
  prev = [];
}

self.onmessage = async (event: MessageEvent<{ buffer: Float32Array }>) => {
  const { buffer } = event.data;
  const { p, speech } = await hear(buffer);
  const { moonshine } = await models;

  if (!piece) {
    if (!speech) {
      if (prev.length >= PREV_BUFFERS) prev.shift();
      prev.push(buffer);
      return;
    }
    const started: Piece = moonshine.stream();
    piece = started;
    lastWords = [];
    for (const b of [...prev, buffer]) void queue(() => started.add(b));
    length = buffer.length;
    prev = [];
    return;
  }
  const current = piece;
  void queue(() => current.add(buffer));
  length += buffer.length;
  sinceRead += buffer.length;

  if (speech) {
    silence = 0;
    if (length >= MAX_PIECE || (length >= LONG_PIECE && p < BREATH)) return end(true);
    // Words as they are said: read the piece so far again, one read at a time.
    if (!reading && length >= FIRST_PARTIAL && sinceRead >= Math.max(PARTIAL_EVERY, HEADROOM * lastReadMs * PER_MS)) {
      sinceRead = 0;
      reading = true;
      void read(current, false).finally(() => {
        reading = false;
      });
    }
    return;
  }
  silence += buffer.length;
  if (silence < MIN_SILENCE) return; // a breath, not the end
  end(length >= MIN_SPEECH + silence);
};
