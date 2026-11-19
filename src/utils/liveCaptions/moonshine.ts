/**
 * Moonshine v2 streaming speech recognition (moonshine-ai/moonshine-streaming, MIT, English), on
 * ONNX Runtime. Ported from Moonshine's core/moonshine-streaming-model.cpp and transcriber.cpp:
 * the encoder keeps up with the audio as it comes (`add`), so reading a piece again (`read`)
 * costs only the decoder, and that reuses the last reading's words (they rarely change).
 * Check: node --experimental-strip-types scripts/moonshine-check.ts <model dir> <16 kHz mono wav>
 */
import type * as Ort from 'onnxruntime-web';

type OrtModule = Pick<typeof Ort, 'InferenceSession' | 'Tensor'>;
type Tensor = Ort.Tensor;

/** streaming_config.json */
export type MoonshineConfig = {
  encoder_dim: number;
  decoder_dim: number;
  depth: number;
  nheads: number;
  head_dim: number;
  bos_id: number;
  eos_id: number;
  total_lookahead: number;
  d_model_frontend: number;
  c1: number;
};

export type MoonshineFiles = {
  frontend: Uint8Array;
  encoder: Uint8Array;
  adapter: Uint8Array;
  cross_kv: Uint8Array;
  decoder_kv: Uint8Array;
  config: MoonshineConfig;
  /** tokenizer.json's model.vocab: piece → id */
  vocab: Record<string, number>;
};

export const MOONSHINE_FILES = ['frontend.onnx', 'encoder.onnx', 'adapter.onnx', 'cross_kv.onnx', 'decoder_kv.onnx'] as const;

const SAMPLE_RATE = 16000;
// Audio goes to the frontend 80 ms at a time: the English graphs lose samples past a whole chunk.
const CHUNK = 1280;
const TOKENS_PER_SECOND = 6.5; // more than this many words a second is the decoder repeating itself
const MAX_TOKENS = 256;

/** Token ids to text: SentencePiece pieces ("▁" is a space) with byte fallback ("<0x0A>"). */
export function detokenizer(vocab: Record<string, number>) {
  const pieces: string[] = [];
  for (const [piece, id] of Object.entries(vocab)) pieces[id] = piece;
  const utf8 = new TextEncoder();
  return (ids: number[]) => {
    const bytes: number[] = [];
    for (const id of ids) {
      const piece = pieces[id];
      if (!piece || (piece.startsWith('<') && piece.endsWith('>') && !piece.startsWith('<0x'))) continue; // <s>, </s>, <unk>
      const byte = /^<0x([0-9A-Fa-f]{2})>$/.exec(piece);
      if (byte) bytes.push(parseInt(byte[1], 16));
      else bytes.push(...utf8.encode(piece.replaceAll('▁', ' ')));
    }
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/^ /, '');
  };
}

/** Appends `add` to the first `used` values of `buffer`, growing it when full. */
function append(buffer: Float32Array, used: number, add: Float32Array): Float32Array {
  if (used + add.length > buffer.length) {
    const grown = new Float32Array(Math.max(buffer.length * 2, used + add.length));
    grown.set(buffer.subarray(0, used));
    buffer = grown;
  }
  buffer.set(add, used);
  return buffer;
}

function argmax(data: Float32Array, from: number, length: number): number {
  let best = 0;
  for (let i = 1; i < length; i++) if (data[from + i] > data[from + best]) best = i;
  return best;
}

/**
 * `context`: frames (20 ms) of earlier audio the encoder reads again with the new ones. Moonshine
 * uses 16 per layer (224, 4.5 s: exactly what it was trained on); each frame costs some 3.5 ms on
 * one thread, and 32 wrote the same words on test speech, a reading in half the time.
 */
export async function loadMoonshine(ort: OrtModule, files: MoonshineFiles, options: Ort.InferenceSession.SessionOptions = {}, context?: number) {
  const [frontend, encoder, adapter, crossKv, decoder] = await Promise.all(
    [files.frontend, files.encoder, files.adapter, files.cross_kv, files.decoder_kv].map((model) => ort.InferenceSession.create(model, options)),
  );
  const cfg = files.config;
  const text = detokenizer(files.vocab);
  const f32 = (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims);
  const i64 = (values: number[], dims: number[]) => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), dims);

  /** One piece of speech, from its first sample: `add` audio as it comes, `read` it at any time. */
  function stream() {
    let state: Record<string, Tensor> = {
      sample_buffer: f32(new Float32Array(79), [1, 79]),
      sample_len: i64([0], [1]),
      conv1_buffer: f32(new Float32Array(cfg.d_model_frontend * 4), [1, cfg.d_model_frontend, 4]),
      conv2_buffer: f32(new Float32Array(cfg.c1 * 4), [1, cfg.c1, 4]),
      frame_count: i64([0], [1]),
    };
    let pending = new Float32Array(0); // less than a chunk, waiting for more
    let samples = 0;
    let features: Float32Array = new Float32Array(0);
    let featureCount = 0;
    let encoded = 0; // features the encoder has turned into memory
    let memory: Float32Array = new Float32Array(0);
    let memoryLength = 0;
    let lastTokens: number[] = [];

    async function add(audio: Float32Array) {
      const all = new Float32Array(pending.length + audio.length);
      all.set(pending);
      all.set(audio, pending.length);
      let at = 0;
      for (; at + CHUNK <= all.length; at += CHUNK) {
        const out = await frontend.run({ audio_chunk: f32(all.slice(at, at + CHUNK), [1, CHUNK]), ...state });
        state = {
          sample_buffer: out.sample_buffer_out,
          sample_len: out.sample_len_out,
          conv1_buffer: out.conv1_buffer_out,
          conv2_buffer: out.conv2_buffer_out,
          frame_count: out.frame_count_out,
        };
        const found = out.features.dims[1];
        if (found > 0) {
          features = append(features, featureCount * cfg.encoder_dim, out.features.data as Float32Array);
          featureCount += found;
        }
        samples += CHUNK;
      }
      pending = all.slice(at);
    }

    /** Turns the features that are settled (all of them at the end) into decoder memory. */
    async function encode(final: boolean) {
      const settled = final ? featureCount : Math.max(0, featureCount - cfg.total_lookahead);
      const fresh = settled - encoded;
      if (fresh <= 0) return;
      const start = Math.max(0, encoded - (context ?? 16 * cfg.depth));
      const dim = cfg.encoder_dim;
      const window = f32(features.slice(start * dim, featureCount * dim), [1, featureCount - start, dim]);
      const out = (await encoder.run({ features: window })).encoded.data as Float32Array;
      const slice = out.slice((encoded - start) * dim, (encoded - start + fresh) * dim);
      const { memory: added } = await adapter.run({ encoded: f32(slice, [1, fresh, dim]), pos_offset: i64([encoded], [1]) });
      memory = append(memory, memoryLength * cfg.decoder_dim, added.data as Float32Array);
      memoryLength += fresh;
      encoded = settled;
    }

    /** What was said so far. `final`: the piece is over, so the last frames count too. */
    async function read(final: boolean): Promise<string> {
      if (final && pending.length) {
        await add(new Float32Array(CHUNK - pending.length)); // the last partial chunk, padded with silence
      }
      await encode(final);
      if (!memoryLength) return '';
      const { k_cross, v_cross } = await crossKv.run({ memory: f32(memory.slice(0, memoryLength * cfg.decoder_dim), [1, memoryLength, cfg.decoder_dim]) });
      const empty = f32(new Float32Array(0), [cfg.depth, 1, cfg.nheads, 0, cfg.head_dim]);
      let kSelf: Tensor = empty;
      let vSelf: Tensor = empty;
      /** Feeds tokens to the decoder; the result gives the next token after each of them. */
      const step = async (tokens: number[]) => {
        const out = await decoder.run(
          { token: i64(tokens, [1, tokens.length]), k_self: kSelf, v_self: vSelf, out_k_cross: k_cross, out_v_cross: v_cross },
          ['logits', 'out_k_self', 'out_v_self'],
        );
        kSelf = out.out_k_self;
        vSelf = out.out_v_self;
        const logits = out.logits.data as Float32Array;
        const size = out.logits.dims[2];
        return (position: number) => argmax(logits, position * size, size);
      };
      const max = Math.min(Math.ceil((samples / SAMPLE_RATE) * TOKENS_PER_SECOND), MAX_TOKENS);
      // The last reading's words, checked in one pass: kept up to the first one that changed.
      const draft = lastTokens.slice(0, max);
      const tokens: number[] = [];
      let after = await step([cfg.bos_id, ...draft]);
      let next = after(0);
      while (tokens.length < draft.length && next === draft[tokens.length]) {
        tokens.push(next);
        next = after(tokens.length);
      }
      if (tokens.length < draft.length) {
        // Changed: the decoder's memory holds the rest of the draft, so it starts again without it.
        kSelf = empty;
        vSelf = empty;
        after = await step([cfg.bos_id, ...tokens]);
        next = after(tokens.length);
      }
      while (next !== cfg.eos_id && tokens.length < max) {
        tokens.push(next);
        next = (await step([next]))(0);
      }
      lastTokens = tokens;
      return text(tokens).trim();
    }

    return { add, read };
  }

  return { stream };
}
