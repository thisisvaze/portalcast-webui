// Live captions: speech to text for whatever is playing, written down as it is said.
// The engine runs in the browser (worker.ts: Moonshine, English; WebGPU, else the CPU). The
// audio is the player's own (captureStream), so the page can read it only when the stream comes
// through PortalCast (the proxy): a stream played straight from the provider is silent to it.
import { isTvApp } from '@/utils/helpers';

export interface LiveCaptionHandlers {
  onText: (text: string) => void;
  /** 'loading': first time, the models download (about 150 MB, then cached). */
  onStatus: (status: 'loading' | 'ready', device: 'webgpu' | 'wasm') => void;
  onError: (message: string) => void;
}

const SAMPLE_RATE = 16000;

// Mono, resampled to 16 kHz, posted 512 samples at a time (the VAD's frame).
const PROCESSOR = `
class PcLiveCaptions extends AudioWorkletProcessor {
  constructor() { super(); this.step = sampleRate / ${SAMPLE_RATE}; this.pos = 0; this.out = new Float32Array(512); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.step) {
      const i = Math.floor(this.pos), f = this.pos - i;
      this.out[this.n++] = ch[i] + ((ch[i + 1] ?? ch[i]) - ch[i]) * f;
      if (this.n === 512) { this.port.postMessage(this.out.slice()); this.n = 0; }
    }
    this.pos -= ch.length;
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

  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  void ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pc-live-captions', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
  source.connect(node); // not to the speakers: the player already plays it

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'text') handlers.onText(m.text);
    else if (m.type === 'status') handlers.onStatus(m.status, m.device);
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
