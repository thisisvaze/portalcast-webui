// Dialogue boost (Off / Low / Medium / High, as in Prime Video), done with Web Audio on the
// player's own <video>: the stereo sides down (dialogue sits in the centre), bass down, the speech
// band up, and a compressor so explosions don't jump out. Saved on this device.
// ponytail: a fixed EQ, not Prime's ML voice separation; a speech-separation model in an
// AudioWorklet is the upgrade if this isn't enough.

export const dialogueBoostLevels = ['off', 'low', 'medium', 'high'] as const;
export type DialogueBoost = (typeof dialogueBoostLevels)[number];

const KEY = 'portalcast:dialogueBoost';
// [speech band dB, bass dB, stereo width (1 = untouched)]
const SETTINGS: Record<DialogueBoost, [number, number, number]> = {
  off: [0, 0, 1],
  low: [4, -3, 0.7],
  medium: [7, -6, 0.45],
  high: [10, -9, 0.25],
};

interface Graph {
  ctx: AudioContext;
  near: GainNode[]; // L→L, R→R
  far: GainNode[]; // L→R, R→L
  bass: BiquadFilterNode;
  speech: BiquadFilterNode;
  comp: DynamicsCompressorNode;
}

let level: DialogueBoost = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    return dialogueBoostLevels.find((l) => l === saved) ?? 'off';
  } catch {
    return 'off';
  }
})();
let current: HTMLMediaElement | null = null;
let waitingForGesture = false;
const graphs = new WeakMap<HTMLMediaElement, Graph>();
const building = new WeakSet<HTMLMediaElement>();
const listeners = new Set<() => void>();

export const getDialogueBoost = () => level;
export function subscribeDialogueBoost(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function setDialogueBoost(next: DialogueBoost, media?: HTMLMediaElement | null) {
  level = next;
  try { localStorage.setItem(KEY, next); } catch { /* this session only */ }
  listeners.forEach((fn) => fn());
  void applyDialogueBoost(media ?? current);
}

/** Sources that would play silence through Web Audio are left alone: cross-origin without CORS,
 *  and Safari's native HLS (a WebKit bug). hls.js plays from a blob: URL (MSE), which is fine. */
function canProcess(media: HTMLMediaElement) {
  const src = media.currentSrc;
  if (!src) return false;
  if (src.startsWith('blob:')) return true;
  try {
    const url = new URL(src, location.href);
    return url.origin === location.origin && !/\.m3u8$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function build(media: HTMLMediaElement): Promise<Graph | null> {
  const ctx = new AudioContext();
  // Once a source node exists the <video> is only heard through the context, so a context the
  // browser hasn't allowed to start yet would mute it. Wait for one that runs.
  await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
  if (ctx.state !== 'running') {
    void ctx.close();
    return null;
  }
  // Exactly two channels in: a mono track lands on both sides, 5.1 folds down to stereo.
  const stereo = ctx.createGain();
  stereo.channelCount = 2;
  stereo.channelCountMode = 'explicit';
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const near = [ctx.createGain(), ctx.createGain()];
  const far = [ctx.createGain(), ctx.createGain()];
  stereo.connect(split);
  for (const ch of [0, 1]) {
    split.connect(near[ch], ch).connect(merge, 0, ch);
    split.connect(far[ch], ch).connect(merge, 0, 1 - ch);
  }
  const bass = Object.assign(ctx.createBiquadFilter(), { type: 'lowshelf' });
  bass.frequency.value = 200;
  const speech = Object.assign(ctx.createBiquadFilter(), { type: 'peaking' });
  speech.frequency.value = 2500;
  speech.Q.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  merge.connect(bass).connect(speech).connect(comp).connect(ctx.destination);
  // Last, so anything above failing leaves the <video> playing as before.
  ctx.createMediaElementSource(media).connect(stereo);
  return { ctx, near, far, bass, speech, comp };
}

export async function applyDialogueBoost(media: HTMLMediaElement | null | undefined): Promise<void> {
  if (!media) return;
  current = media;
  let g = graphs.get(media);
  if (!g) {
    if (level === 'off' || building.has(media) || typeof AudioContext === 'undefined' || !canProcess(media)) return;
    building.add(media); // a <video> takes one source node, ever
    const built = await build(media).finally(() => building.delete(media));
    if (!built) {
      // Autoplay without a click yet: try again on the next one.
      if (!waitingForGesture) {
        waitingForGesture = true;
        const retry = () => {
          waitingForGesture = false;
          document.removeEventListener('pointerdown', retry, true);
          document.removeEventListener('keydown', retry, true);
          void applyDialogueBoost(current);
        };
        document.addEventListener('pointerdown', retry, true);
        document.addEventListener('keydown', retry, true);
      }
      return;
    }
    graphs.set(media, (g = built));
  }
  const [speechDb, bassDb, width] = SETTINGS[level];
  const t = g.ctx.currentTime;
  // L' = a·L + b·R, R' = b·L + a·R: width 1 is the original, lower pulls the sides in.
  g.near.forEach((n) => n.gain.setTargetAtTime((1 + width) / 2, t, 0.05));
  g.far.forEach((n) => n.gain.setTargetAtTime((1 - width) / 2, t, 0.05));
  g.bass.gain.setTargetAtTime(bassDb, t, 0.05);
  g.speech.gain.setTargetAtTime(speechDb, t, 0.05);
  // Off: ratio 1 is no compression.
  g.comp.threshold.value = level === 'off' ? 0 : -24;
  g.comp.ratio.value = level === 'off' ? 1 : 4;
  g.comp.attack.value = 0.005;
  g.comp.release.value = 0.25;
}
