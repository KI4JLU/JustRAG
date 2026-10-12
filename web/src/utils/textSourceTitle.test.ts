import { describe, expect, it } from 'vitest';
import { markdownSourceTitle } from './textSourceTitle';

// ORACLE: the naming rule itself, written out per case.
describe('markdownSourceTitle', () => {
  it('appends .md to a plain title', () => {
    expect(markdownSourceTitle('Hallo Welt')).toBe('Hallo Welt.md');
  });
  it('keeps an existing .md / .markdown suffix, in any case', () => {
    expect(markdownSourceTitle('notes.md')).toBe('notes.md');
    expect(markdownSourceTitle('Notes.MD')).toBe('Notes.MD');
    expect(markdownSourceTitle('readme.markdown')).toBe('readme.markdown');
  });
  it('trims, and leaves an empty title undefined', () => {
    expect(markdownSourceTitle('  Plan  ')).toBe('Plan.md');
    expect(markdownSourceTitle('   ')).toBeUndefined();
  });
  it('does not treat a .txt title as markdown', () => {
    expect(markdownSourceTitle('liste.txt')).toBe('liste.txt.md');
  });
});
