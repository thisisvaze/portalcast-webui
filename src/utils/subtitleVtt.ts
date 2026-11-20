/** Normalize SRT and check the timed text before replacing the viewer's active captions. */
export async function subtitleVtt(text: string): Promise<string> {
  const body = text.trimStart().replace(/\r\n?/g, '\n');
  const timings = /^(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}[ \t]+-->[ \t]+(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}/gm;
  const vtt = /^WEBVTT\b/.test(body) ? body : 'WEBVTT\n\n' + body.replace(timings, line => line.replace(/,/g, '.'));
  const { parseText } = await import('media-captions');
  const { cues } = await parseText(vtt, { errors: false });
  if (!cues.some(cue => cue.endTime > cue.startTime && cue.text.trim())) {
    throw new Error('No timed subtitle text');
  }
  return vtt;
}
