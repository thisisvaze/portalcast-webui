// Live captions: speech to text for whatever is playing, written down as it is said.
// On a Mac running the captions helper (mlx-audio's server with NVIDIA's Nemotron streaming
// model, on the Mac's GPU: ws://127.0.0.1:8881) the words come from there, a fraction of a second
// after they are said; anywhere else the engine runs in the browser (worker.ts: Moonshine v2
// streaming, English, on the CPU, 1.5 to 2 s behind). The audio is the player's own
// (captureStream), so the page can read it only when the stream comes through PortalCast (the
// proxy): a stream played straight from the provider is silent to it.
import { isTvApp } from '@/utils/helpers';
import { readTrackPcm } from './trackPcm';

export interface LiveCaptionHandlers {
  /** final false: the line being said, so far (it is replaced); true: that line, settled. */
  onText: (text: string, final: boolean) => void;
  onError: (message: string) => void;
}

export type Device = 'mac' | 'webgpu' | 'wasm';

const SAMPLE_RATE = 16000;
// The captions helper (scripts/mac-captions-helper.sh): mlx-audio's OpenAI Realtime-style socket.
const HELPER = 'ws://127.0.0.1:8881/v1/realtime';

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

/** The captions helper's socket, ready for audio; null when it does not answer within a second. */
function connectHelper(): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(HELPER);
    } catch {
      return resolve(null);
    }
    const give = (ok: boolean) => {
      clearTimeout(timer);
      socket.onmessage = socket.onerror = socket.onclose = null;
      if (!ok) socket.close();
      resolve(ok ? socket : null);
    };
    const timer = setTimeout(() => give(false), 1000);
    socket.onerror = socket.onclose = () => give(false);
    socket.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'session.created') {
        // 16 kHz PCM in; the helper's own voice detector ends each piece at a pause.
        socket.send(JSON.stringify({ type: 'session.update', session: { audio: { input: { format: { type: 'audio/pcm', rate: SAMPLE_RATE }, turn_detection: { type: 'server_vad' } } } } }));
      } else if (m.type === 'session.updated') give(true);
      else if (m.type === 'error') give(false);
    };
  });
}

/** 16-bit PCM, base64: what the helper takes. */
function pcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return btoa(String.fromCharCode(...bytes));
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

/** Starts capture and recognition together; a stale start releases both, even mid-handshake. */
export async function startLiveCaptions(media: HTMLMediaElement, handlers: LiveCaptionHandlers, signal?: AbortSignal): Promise<() => void> {
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
  signal?.addEventListener('abort', close, { once: true });
  try {
    await waitForAudio(stream, signal);
    if (closed) throw new DOMException('Capture stopped', 'AbortError');
    const stop = await capturePcm(stream, pcm => send?.(pcm), () => handlers.onError('capture-ended'));
    if (closed) { stop(); throw new DOMException('Capture stopped', 'AbortError'); }
    stopPcm = stop;
    const helper = await connectHelper();
    if (closed) { helper?.close(); throw new DOMException('Capture stopped', 'AbortError'); }
    if (helper) {
      stopEngine = attachHelper(helper, handlers);
      send = pcm => {
        if (helper.readyState === WebSocket.OPEN) helper.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcm16(pcm) }));
      };
    } else {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      stopEngine = () => worker.terminate();
      attachWorker(worker, handlers);
      send = pcm => worker.postMessage({ buffer: pcm }, [pcm.buffer]);
    }
    return close;
  } catch (error) { close(); throw error; }
}

function attachHelper(helper: WebSocket, handlers: LiveCaptionHandlers): () => void {
  let piece = '';
  helper.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'conversation.item.input_audio_transcription.delta') {
      piece += m.delta;
      handlers.onText(piece.trim(), false);
    } else if (m.type === 'conversation.item.input_audio_transcription.completed') {
      piece = '';
      if (m.transcript?.trim()) handlers.onText(m.transcript.trim(), true);
    } else if (m.type === 'error') handlers.onError(m.error?.message ?? 'helper-error');
  };
  helper.onclose = () => handlers.onError('helper-closed');
  console.info('[live-captions] ready: Nemotron on this Mac (captions helper)');
  return () => {
    helper.onclose = helper.onmessage = null;
    helper.close();
  };
}

function attachWorker(worker: Worker, handlers: LiveCaptionHandlers) {
  worker.onerror = () => handlers.onError('worker-error');
  let device: Device = 'wasm';
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'text') handlers.onText(m.text, m.final);
    else if (m.type === 'status') {
      if (m.status === 'ready') device = m.device;
      console.info(`[live-captions] ${m.status}: ${m.model} on the ${m.device === 'webgpu' ? 'GPU' : 'CPU'}`);
    } else if (m.type === 'stats') {
      // The console's record of each read: how much audio, how long it took, on what.
      console.info(`[live-captions] ${m.kind} ${m.seconds}s → ${m.ms} ms (${device === 'webgpu' ? 'GPU' : 'CPU'}) ${JSON.stringify(m.text)}`);
    }
    else if (m.type === 'error') handlers.onError(m.message);
  };
}
