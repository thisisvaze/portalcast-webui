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
// A word longer than a line is a line of its own.
assert.deepEqual(captionLines('short supercalifragilisticexpialidocious', 10, 2), ['short', 'supercalifragilisticexpialidocious']);
console.log('captionLines: all checks passed');
