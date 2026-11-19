// Self-check for src/utils/liveCaptions/lines.ts: node --experimental-strip-types scripts/caption-lines-check.ts
import assert from 'node:assert/strict';
import { captionLines } from '../src/utils/liveCaptions/lines.ts';

assert.deepEqual(captionLines(''), []);
assert.deepEqual(captionLines('A trip to break the walls of Troy.'), ['A trip to break the walls of Troy.']);
// Two lines at most, the newest words kept, broken between words.
const long = 'A trip to break the walls of Troy and burn it. And Barney, scream into the ground.';
const lines = captionLines(long, 42, 2);
assert.equal(lines.length, 2);
assert.ok(lines.every((l) => l.length <= 42));
assert.equal(lines.join(' ').endsWith('scream into the ground.'), true);
assert.equal(long.endsWith(lines.join(' ')), true);
// Words stay where they are: a new word goes on the end of the last line or starts a new one.
const words = long.split(' ');
for (let n = 1; n < words.length; n++) {
  const before = captionLines(words.slice(0, n).join(' '), 42, 10);
  const after = captionLines(words.slice(0, n + 1).join(' '), 42, 10);
  assert.deepEqual(after.slice(0, before.length - 1), before.slice(0, -1));
  assert.ok(after[before.length - 1].startsWith(before[before.length - 1]));
}
// Keeping only the last lines of what was said keeps the lines as they were.
const kept = captionLines(long).join(' ');
assert.deepEqual(captionLines(`${kept} and more words here`, 42, 10).slice(0, 2), captionLines(long));
// A word longer than a line is a line of its own.
assert.deepEqual(captionLines('short supercalifragilisticexpialidocious', 10, 2), ['short', 'supercalifragilisticexpialidocious']);
console.log('captionLines: all checks passed');
