export const subtitleSizes = ['small', 'medium', 'large'] as const;
export type SubtitleSize = (typeof subtitleSizes)[number];
export const subtitleSizeKey = 'portalcast:subtitleSize';

export function savedSubtitleSize(): SubtitleSize {
  try {
    const saved = localStorage.getItem(subtitleSizeKey);
    return subtitleSizes.find(size => size === saved) ?? 'medium';
  } catch {
    return 'medium';
  }
}
