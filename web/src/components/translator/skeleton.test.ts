import { describe, expect, it } from 'vitest';
import { SKELETON_LINES_MAX, SKELETON_WORDS_MAX, skeletonWords } from './skeleton';

describe('skeletonWords', () => {
  it('lists the words of each line and keeps an empty line as an empty list', () => {
    expect(skeletonWords('Guten Morgen\n\nWie  geht es dir?')).toEqual([['Guten', 'Morgen'], [], ['Wie', 'geht', 'es', 'dir?']]);
  });

  it('is empty-lined for an empty source, so the placeholder still has a first line', () => {
    expect(skeletonWords('')).toEqual([[]]);
  });

  it('stops at the word limit and leaves the lines after it empty', () => {
    const line = Array.from({ length: SKELETON_WORDS_MAX }, () => 'w').join(' ');
    const lines = skeletonWords(`${line}\nmore words`);
    expect(lines[0]).toHaveLength(SKELETON_WORDS_MAX);
    expect(lines[1]).toEqual([]);
  });

  it('draws no more lines than the limit', () => {
    expect(skeletonWords('x\n'.repeat(SKELETON_LINES_MAX * 2))).toHaveLength(SKELETON_LINES_MAX);
  });
});
