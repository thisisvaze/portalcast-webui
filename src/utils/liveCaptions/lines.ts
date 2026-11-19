/**
 * Live captions as at most `maxLines` lines of at most `maxChars` (broadcast captions: 2 lines of
 * 32 to 42), roll-up style: words fill a line left to right and stay where they are; a full line
 * moves up whole and the top one goes. (Wrapping from the newest word instead moved every word
 * along each time one came, which could not be read.) A word longer than a line has a line of its own.
 * Check: node --experimental-strip-types scripts/caption-lines-check.ts
 */
export function captionLines(text: string, maxChars = 42, maxLines = 2): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + 1 + word.length <= maxChars) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines.slice(-maxLines);
}
