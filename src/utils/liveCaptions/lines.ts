/**
 * The newest words of live captions as at most `maxLines` lines of at most `maxChars` (broadcast
 * captions: 2 lines of 32 to 42), broken between words. Older words fall off the top as new
 * ones come, as YouTube's live captions roll. A word longer than a line gets a line of its own.
 * Check: node --experimental-strip-types scripts/caption-lines-check.ts
 */
export function captionLines(text: string, maxChars = 42, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (line && line.length + 1 + word.length > maxChars) {
      lines.unshift(line);
      if (lines.length === maxLines) return lines;
      line = word;
    } else {
      line = line ? `${word} ${line}` : word;
    }
  }
  if (line) lines.unshift(line);
  return lines.slice(-maxLines);
}
