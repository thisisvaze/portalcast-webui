/// <reference lib="webworker" />
// English 560 ms RNNT decoder adapted from mja00/twitch-cc (MIT, notice in logMel.ts).
import * as ort from 'onnxruntime-web/webgpu';
import wasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { LogMelExtractor, MEL_BINS } from './logMel';
import { bytes, download } from './modelFiles';

ort.env.wasm.wasmPaths = { wasm };
ort.env.wasm.numThreads = 1;
const base = 'https://huggingface.co/mja00/nemotron-speech-streaming-en-0.6b-webgpu/resolve/1a8ebba8c1ea3a074b1748729ab5816a53d140ab/';
const windowFrames = 65;
const shiftFrames = 56;
const encoderWidth = 1024;
const post = (message: unknown) => (self as DedicatedWorkerGlobalScope).postMessage(message);
const zeros = (dims: number[]): ort.Tensor => new ort.Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);

async function load() {
  const gpu = (navigator as WorkerNavigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!await gpu?.requestAdapter()) throw new Error('WebGPU is unavailable');
  post({ type: 'status', status: 'loading', device: 'webgpu', model: 'Nemotron', size: '716 MB' });
  const [graph, data, decoderGraph, joinerGraph, vocabulary] = await Promise.all([
    bytes(base + 'encoder.q4.onnx'), bytes(base + 'encoder.q4.data'), bytes(base + 'decoder.onnx'),
    bytes(base + 'joiner.onnx'), download(base + 'tokens.txt').then(r => r.text()),
  ]);
  const encoder = await ort.InferenceSession.create(graph, {
    executionProviders: ['webgpu'], externalData: [{ path: 'encoder.q4.data', data }],
  });
  const decoder = await ort.InferenceSession.create(decoderGraph, { executionProviders: ['wasm'] });
  const joiner = await ort.InferenceSession.create(joinerGraph, { executionProviders: ['wasm'] });
  const tokens = vocabulary.trimEnd().split('\n').map(line => line.slice(0, line.lastIndexOf(' ')));
  const blank = tokens.indexOf('<blk>');
  if (blank < 0) throw new Error('Missing Nemotron blank token');
  return { encoder, decoder, joiner, tokens, blank };
}

type Model = Awaited<ReturnType<typeof load>>;
function stream(model: Model) {
  const extractor = new LogMelExtractor();
  // Give the streaming encoder left context when speech begins in the very first packet.
  let frames = extractor.accept(new Float32Array(8000));
  let busy = false;
  const initialCaches = (): Record<string, ort.Tensor> => ({
    cache_last_channel: zeros([1, 24, 70, encoderWidth]),
    cache_last_time: zeros([1, 24, encoderWidth, 8]),
    cache_last_channel_len: new ort.Tensor('int64', BigInt64Array.of(BigInt(0)), [1]),
  });
  let caches = initialCaches();
  let hidden = zeros([2, 1, 640]);
  let cell = zeros([2, 1, 640]);
  let prediction: ort.Tensor | undefined;
  let phrase = '';
  let silentChunks = 0;

  function finish() {
    if (phrase.trim()) post({ type: 'text', text: phrase.trim(), final: true });
    phrase = '';
  }

  async function predict(token: number) {
    const out = await model.decoder.run({
      targets: new ort.Tensor('int32', Int32Array.of(token), [1, 1]),
      target_length: new ort.Tensor('int32', Int32Array.of(1), [1]),
      'states.1': hidden, 'onnx::Slice_3': cell,
    });
    hidden = out.states;
    cell = out['162'];
    return out.outputs;
  }

  async function decode(features: Float32Array) {
    const out = await model.encoder.run({
      audio_signal: new ort.Tensor('float32', features, [1, MEL_BINS, windowFrames]),
      length: new ort.Tensor('int64', BigInt64Array.of(BigInt(windowFrames)), [1]),
      ...caches,
    });
    caches = {
      cache_last_channel: out.cache_last_channel_next,
      cache_last_time: out.cache_last_time_next,
      cache_last_channel_len: out.cache_last_channel_next_len,
    };
    const encoded = out.outputs.data as Float32Array;
    const steps = out.outputs.dims[2];
    let spoken = false;
    prediction ??= await predict(model.blank);
    for (let t = 0; t < steps; t++) {
      const column = Float32Array.from({ length: encoderWidth }, (_, d) => encoded[d * steps + t]);
      const frame = new ort.Tensor('float32', column, [1, encoderWidth, 1]);
      for (let symbol = 0; symbol < 10; symbol++) {
        const { outputs } = await model.joiner.run({ encoder_outputs: frame, decoder_outputs: prediction });
        const logits = outputs.data as Float32Array;
        let best = 0;
        for (let k = 1; k < logits.length; k++) if (logits[k] > logits[best]) best = k;
        if (best === model.blank) break;
        const piece = model.tokens[best];
        if (piece && piece !== '<unk>') {
          if (piece.startsWith('▁') && (phrase.length > 180 || /[.?!]$/.test(phrase))) finish();
          phrase += piece.replaceAll('▁', ' ');
          spoken = true;
        }
        prediction = await predict(best);
      }
    }
    silentChunks = spoken ? 0 : silentChunks + 1;
    if (spoken) post({ type: 'text', text: phrase.trim(), final: false });
    else if (silentChunks >= 3) finish();
  }

  return async (pcm: Float32Array) => {
    frames.push(...extractor.accept(pcm));
    if (busy) return;
    busy = true;
    try {
      while (frames.length >= windowFrames) {
        // After a GPU stall, resume from the live audio with fresh acoustic and word context.
        if (frames.length > windowFrames + 300) {
          frames = frames.slice(-windowFrames);
          finish();
          caches = initialCaches();
          hidden = zeros([2, 1, 640]);
          cell = zeros([2, 1, 640]);
          prediction = undefined;
        }
        const features = new Float32Array(MEL_BINS * windowFrames);
        for (let i = 0; i < windowFrames; i++) {
          for (let b = 0; b < MEL_BINS; b++) features[b * windowFrames + i] = frames[i][b];
        }
        frames.splice(0, shiftFrames);
        await decode(features);
      }
    } finally { busy = false; }
  };
}

function fail(error: unknown) {
  self.onmessage = null;
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}

void load().then(model => {
  const accept = stream(model);
  self.onmessage = (e: MessageEvent<{ buffer: Float32Array }>) => void accept(e.data.buffer).catch(fail);
  post({ type: 'status', status: 'ready', device: 'webgpu', model: 'Nemotron' });
}).catch(fail);
