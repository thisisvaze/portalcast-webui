export interface CaptionLine {
  /** Absolute position of the first word, also when a line rolls up. */
  start: number;
  text: string;
}

/** Keep the newest two lines. Break from the start so appending a word leaves earlier words in place. */
export function captionLines(text: string, maxChars = 42, maxLines = 2, firstWord = 0): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let position = firstWord;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last && last.text.length + 1 + word.length <= maxChars) last.text += ` ${word}`;
    else lines.push({ start: position, text: word });
    position++;
  }
  return lines.slice(-maxLines);
}
