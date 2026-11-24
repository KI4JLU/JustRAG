import { describe, expect, it } from 'vitest';
import { passageMarkTexts } from './passageMarks';

// Oracle: what the source panel marks in the passage (SourceExcerpt), read
// off the passage text by hand — the full PDF view is to mark the same text.
describe('passageMarkTexts', () => {
    const passage = 'Eine nicht bestandene Prüfung kann zweimal wiederholt werden. Die Wiederholung findet im folgenden Semester statt.';

    it('takes the verified citation span', () => {
        expect(passageMarkTexts(passage, { start: 0, end: 61 }, 'irrelevant')).toEqual([
            'Eine nicht bestandene Prüfung kann zweimal wiederholt werden.',
        ]);
    });

    it('takes the sentence matching the citing statement without a span', () => {
        expect(passageMarkTexts(passage, undefined, 'Die Wiederholung einer Prüfung findet im folgenden Semester statt [2].')).toEqual([
            'Die Wiederholung findet im folgenden Semester statt.',
        ]);
    });

    it('ignores a span that does not fit the passage', () => {
        expect(passageMarkTexts(passage, { start: 500, end: 600 }, undefined)).toEqual([passage]);
    });

    it('falls back to the whole passage when nothing is marked', () => {
        expect(passageMarkTexts(passage, undefined, undefined)).toEqual([passage]);
        expect(passageMarkTexts('   ', undefined, undefined)).toEqual([]);
    });
});
