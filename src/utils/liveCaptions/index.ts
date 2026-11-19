// Live captions use the browser's copy of the player audio. Cross-origin provider streams need the proxy.
import { isTvApp } from '@/utils/helpers';
import { readTrackPcm } from './trackPcm';
import type { CaptionEngine } from './preference';

export interface LiveCaptionHandlers {
  /** final false: the line being said, so far (it is replaced); true: that line, settled. */
  onText: (text: string, final: boolean) => void;
  onError: (message: string) => void;
  onLoading?: (message: string) => void;
}

const SAMPLE_RATE = 16000;
// Mono at 16 kHz, posted 512 samples at a time (the VAD's frame). The context runs at 16 kHz where
// the browser can (Chromium: it resamples with a proper filter); elsewhere each output sample is the
// mean of the input samples it covers (a simple low-pass, so speech is not aliased).
const PROCESSOR = `
class PcLiveCaptions extends AudioWorkletProcessor {
  constructor() { super(); this.step = sampleRate / ${SAMPLE_RATE}; this.acc = 0; this.sum = 0; this.cnt = 0; this.out = new Float32Array(512); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.cnt++; this.acc += 1;
      if (this.acc >= this.step) {
        this.acc -= this.step;
        this.out[this.n++] = this.sum / this.cnt; this.sum = 0; this.cnt = 0;
        if (this.n === 512) { this.port.postMessage(this.out.slice()); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('pc-live-captions', PcLiveCaptions);
`;

let moduleWorkers: boolean | null = null;
function canRunModuleWorkers(): boolean {
  if (moduleWorkers !== null) return moduleWorkers;
  moduleWorkers = false;
  try {
    const opts = { get type() { moduleWorkers = true; return 'module' as const; } };
    new Worker(URL.createObjectURL(new Blob([''])), opts).terminate();
  } catch {
    moduleWorkers = false;
  }
  return moduleWorkers;
}

/** Whether this browser can run live captions (never the TV apps: too little to run it on). */
export function liveCaptionsSupported(): boolean {
  return (
    !isTvApp() &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof HTMLMediaElement !== 'undefined' &&
    'captureStream' in HTMLMediaElement.prototype &&
    canRunModuleWorkers()
  );
}

/** Chromium can expose the video before it adds the audio to the same capture stream. */
function waitForAudio(stream: MediaStream, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      stream.removeEventListener('addtrack', check);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const check = () => { if (stream.getAudioTracks().some(t => t.readyState === 'live')) finish(); };
    const abort = () => finish(new DOMException('Caption selection changed', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('no-audio')), 10000);
    stream.addEventListener('addtrack', check);
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    else check();
  });
}

async function capturePcm(stream: MediaStream, emit: (pcm: Float32Array) => void, onError: () => void): Promise<() => void> {
  // 16 kHz where the browser resamples a stream itself (Chromium); else its own rate.
  let ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  if (ctx.state === 'suspended') {
    const track = stream.getAudioTracks().find(t => t.readyState === 'live');
    const stop = track && readTrackPcm(track, SAMPLE_RATE, emit, onError);
    if (stop) {
      void ctx.close();
      return stop;
    }
  }
  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch {
    void ctx.close();
    ctx = new AudioContext();
    try { source = ctx.createMediaStreamSource(stream); }
    catch (error) { void ctx.close(); throw error; }
  }
  const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'text/javascript' }));
  let node: AudioWorkletNode;
  try {
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, 'pc-live-captions', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => emit(e.data);
    source.connect(node); // not to the speakers: the player already plays it
  } catch (error) {
    void ctx.close(); throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
  // Autoplay can run the video while Web Audio still needs user activation.
  const resume = () => { if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined); };
  document.addEventListener('click', resume, true);
  document.addEventListener('keydown', resume, true);
  resume();

  console.info(`[live-captions] audio at ${ctx.sampleRate} Hz${ctx.sampleRate === SAMPLE_RATE ? '' : ' (downsampled here)'}`);
  return () => {
    document.removeEventListener('click', resume, true);
    document.removeEventListener('keydown', resume, true);
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    void ctx.close();
  };
}

/** Stop both audio capture and recognition when the track or channel changes. */
export async function startLiveCaptions(media: HTMLMediaElement, handlers: LiveCaptionHandlers, signal?: AbortSignal, engine: CaptionEngine = 'nemotron'): Promise<() => void> {
  if (signal?.aborted) throw new DOMException('Capture stopped', 'AbortError');
  const stream = (media as HTMLMediaElement & { captureStream(): MediaStream }).captureStream();
  let send: ((pcm: Float32Array) => void) | undefined;
  let stopPcm: (() => void) | undefined, stopEngine: (() => void) | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', close);
    send = undefined;
    stopEngine?.();
    stopPcm?.();
    stream.getTracks().forEach(t => t.stop());
  };
  const startBrowser = (choice: CaptionEngine) => {
    if (closed) return;
    send = undefined;
    stopEngine?.();
    stopEngine = undefined;
    const failed = (message: string) => {
      console.warn(`[live-captions] ${choice}: ${message}`);
      if (choice === 'nemotron') startBrowser('moonshine');
      else handlers.onError('worker-error');
    };
    try {
      const worker = choice === 'nemotron'
        ? new Worker(new URL('./nemotron.worker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      stopEngine = () => { worker.onerror = worker.onmessage = null; worker.terminate(); };
      attachWorker(worker, { ...handlers, onError: failed }, () => {
        send = pcm => worker.postMessage({ buffer: pcm }, [pcm.buffer]);
      });
    } catch (error) { failed(String(error)); }
  };
  signal?.addEventListener('abort', close, { once: true });
  try {
    await waitForAudio(stream, signal);
    if (closed) throw new DOMException('Capture stopped', 'AbortError');
    const stop = await capturePcm(stream, pcm => send?.(pcm), () => handlers.onError('capture-ended'));
    if (closed) { stop(); throw new DOMException('Capture stopped', 'AbortError'); }
    stopPcm = stop;
    startBrowser('gpu' in navigator ? engine : 'moonshine');
    return close;
  } catch (error) { close(); throw error; }
}

function attachWorker(worker: Worker, handlers: LiveCaptionHandlers, ready: () => void) {
  worker.onerror = e => handlers.onError(e.message || 'worker-error');
  let device: 'webgpu' | 'wasm' = 'wasm';
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'text') handlers.onText(m.text, m.final);
    else if (m.type === 'status') {
      if (m.status === 'ready') { device = m.device; handlers.onLoading?.(''); ready(); }
      else if (m.status === 'loading') handlers.onLoading?.(`Loading ${m.model} captions (${m.size} on first use)…`);
      console.info(`[live-captions] ${m.status}: ${m.model} on the ${m.device === 'webgpu' ? 'GPU' : 'CPU'}`);
    } else if (m.type === 'stats') {
      // The console's record of each read: how much audio, how long it took, on what.
      console.info(`[live-captions] ${m.kind} ${m.seconds}s → ${m.ms} ms (${device === 'webgpu' ? 'GPU' : 'CPU'}) ${JSON.stringify(m.text)}`);
    }
    else if (m.type === 'error') handlers.onError(m.message);
  };
}
