// What the loading placeholder of the result is drawn from.

/** Words and lines drawn at most, so a very long text does not fill the page with bars. */
export const SKELETON_WORDS_MAX = 800;
export const SKELETON_LINES_MAX = 300;
/** A bar's width per letter of its word, in the board's own type size (the average letter is a bit over half an em wide). */
export const SKELETON_EM_PER_LETTER = 0.52;

/** The words of each line of the source, an empty line as an empty list, up to the limits. */
export function skeletonWords(source: string): string[][] {
  let left = SKELETON_WORDS_MAX;
  return source
    .split('\n')
    .slice(0, SKELETON_LINES_MAX)
    .map((line) => {
      const words = line.split(/\s+/).filter(Boolean).slice(0, left);
      left -= words.length;
      return words;
    });
}
