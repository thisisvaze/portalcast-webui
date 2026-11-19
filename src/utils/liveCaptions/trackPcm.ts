// Chromium exposes decoded audio frames from an already-playing media track even when
// autoplay policy suspends Web Audio. No microphone, speaker connection or gesture needed.
interface Frame {
  numberOfFrames: number;
  numberOfChannels: number;
  sampleRate: number;
  copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void;
  close(): void;
}
type Processor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<Frame> };

export function readTrackPcm(track: MediaStreamTrack, rate: number, emit: (pcm: Float32Array) => void, onError: () => void): (() => void) | null {
  const Processor = (window as Window & { MediaStreamTrackProcessor?: Processor }).MediaStreamTrackProcessor;
  if (!Processor) return null;
  let reader: ReadableStreamDefaultReader<Frame>;
  try { reader = new Processor({ track }).readable.getReader(); }
  catch { return null; } // Some browsers only implement video frames.
  let stopped = false, finished = false;
  const read = async () => {
    let channels: Float32Array[] = [], batch = new Float32Array(512), n = 0, sum = 0, weight = 0;
    try {
      while (!stopped) {
        const { value: frame, done } = await reader.read();
        if (done) break;
        try {
          if (stopped) break;
          const count = frame.numberOfChannels;
          if (channels.length !== count || channels[0]?.length !== frame.numberOfFrames) {
            channels = Array.from({ length: count }, () => new Float32Array(frame.numberOfFrames));
          }
          channels.forEach((dst, planeIndex) => frame.copyTo(dst, { planeIndex, format: 'f32-planar' }));
          // Downmix and average over each output sample's interval. Carry the fractional
          // interval across frame boundaries (e.g. 44.1 kHz) so captions never drift.
          for (let i = 0; i < frame.numberOfFrames; i++) {
            let mono = 0;
            for (let c = 0; c < count; c++) mono += channels[c][i];
            mono /= count;
            let remaining = rate;
            while (remaining > 0) {
              const take = Math.min(remaining, frame.sampleRate - weight);
              sum += mono * take; weight += take; remaining -= take;
              if (weight === frame.sampleRate) {
                batch[n++] = sum / weight; weight = 0; sum = 0;
                if (n === batch.length) { emit(batch); batch = new Float32Array(512); n = 0; }
              }
            }
          }
        } finally { frame.close(); }
      }
      // A clip ending also closes its track; that's not a recognition failure.
    } catch { if (!stopped) onError(); }
    finally { finished = true; reader.releaseLock(); }
  };
  void read();
  return () => { stopped = true; if (!finished) void reader.cancel().catch(() => undefined); };
}
