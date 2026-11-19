// Live captions: speech to text for whatever is playing, written down as it is said.
// The engine runs in the browser (worker.ts: Moonshine v2 streaming, English, on the CPU). The
// audio is the player's own (captureStream), so the page can read it only when the stream comes
// through PortalCast (the proxy): a stream played straight from the provider is silent to it.
import { isTvApp } from '@/utils/helpers';

export interface LiveCaptionHandlers {
  /** final false: the line being said, so far (it is replaced); true: that line, settled. */
  onText: (text: string, final: boolean) => void;
  /** 'loading': the first time, the model downloads (`size`, then cached). */
  onStatus: (status: 'loading' | 'ready', device: 'webgpu' | 'wasm', model: string, size?: string) => void;
  onError: (message: string) => void;
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

/** Starts live captions for `media`; the returned function stops them. */
export async function startLiveCaptions(media: HTMLMediaElement, handlers: LiveCaptionHandlers): Promise<() => void> {
  const stream = (media as HTMLMediaElement & { captureStream(): MediaStream }).captureStream();
  if (stream.getAudioTracks().length === 0) throw new Error('no-audio');

  // 16 kHz where the browser resamples a stream itself (Chromium); else its own rate.
  let ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch {
    void ctx.close();
    ctx = new AudioContext();
    source = ctx.createMediaStreamSource(stream);
  }
  const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  void ctx.resume();
  const node = new AudioWorkletNode(ctx, 'pc-live-captions', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
  source.connect(node); // not to the speakers: the player already plays it

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let device: 'webgpu' | 'wasm' = 'wasm';
  console.info(`[live-captions] audio at ${ctx.sampleRate} Hz${ctx.sampleRate === SAMPLE_RATE ? '' : ' (downsampled here)'}`);
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'text') handlers.onText(m.text, m.final);
    else if (m.type === 'status') {
      if (m.status === 'ready') device = m.device;
      console.info(`[live-captions] ${m.status}: ${m.model} on the ${m.device === 'webgpu' ? 'GPU' : 'CPU'}`);
      handlers.onStatus(m.status, m.device, m.model, m.size);
    } else if (m.type === 'stats') {
      // The console's record of each read: how much audio, how long it took, on what.
      console.info(`[live-captions] ${m.kind} ${m.seconds}s → ${m.ms} ms (${device === 'webgpu' ? 'GPU' : 'CPU'}) ${JSON.stringify(m.text)}`);
    }
    else if (m.type === 'error') handlers.onError(m.message);
  };
  node.port.onmessage = (e: MessageEvent<Float32Array>) => worker.postMessage({ buffer: e.data }, [e.data.buffer]);

  return () => {
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    void ctx.close();
    worker.terminate();
    stream.getTracks().forEach((t) => t.stop());
  };
}
