import assert from 'node:assert/strict';
import test from 'node:test';
import { subtitleVtt } from '../src/utils/subtitleVtt.ts';
import { parseText } from 'media-captions';

test('a device SRT produces timed cues without changing the dialogue', async () => {
  const srt = '\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nAt 10:00:00,000\r\nSecond line\r\n';
  const vtt = await subtitleVtt(srt);
  const { cues } = await parseText(vtt);
  assert.deepEqual(cues.map(cue => [cue.startTime, cue.endTime, cue.text]), [
    [1.25, 3.5, 'At 10:00:00,000\nSecond line'],
  ]);
  assert.equal(await subtitleVtt(vtt), vtt);
});

test('Best match skips empty downloads, error pages and cues with no dialogue', async () => {
  for (const body of ['WEBVTT\n\n', '<html>Sign in</html>', 'WEBVTT\n\n00:00:02.000 --> 00:00:03.000\n\n']) {
    await assert.rejects(subtitleVtt(body), /No timed subtitle text/);
  }
});
