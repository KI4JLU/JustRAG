import { describe, it, expect } from 'vitest';
import { normalizeMathDelimiters } from './markdownMath';

describe('normalizeMathDelimiters', () => {
    it('turns \\( … \\) into inline $ … $', () => {
        expect(normalizeMathDelimiters('Es gilt \\(a^2 + b^2 = c^2\\) im Dreieck.'))
            .toBe('Es gilt $a^2 + b^2 = c^2$ im Dreieck.');
    });

    it('turns \\[ … \\] into a display $$ block on its own lines', () => {
        expect(normalizeMathDelimiters('Formel:\n\\[\n\\frac{a}{b}\n\\]\nEnde'))
            .toBe('Formel:\n\n$$\n\\frac{a}{b}\n$$\n\nEnde');
    });

    it('leaves the escaped citation form \\[1\\] / \\[1, 2\\] alone', () => {
        const s = 'Siehe \\[1\\] und \\[2, 3\\].';
        expect(normalizeMathDelimiters(s)).toBe(s);
    });

    it('does not touch code spans or fenced blocks', () => {
        const s = 'Nutze `\\(x\\)` oder\n```\n\\[y\\]\n```\n';
        expect(normalizeMathDelimiters(s)).toBe(s);
    });

    it('leaves text without math untouched', () => {
        const s = 'Ganz normaler Text (mit Klammern) und [Links](http://x).';
        expect(normalizeMathDelimiters(s)).toBe(s);
    });
});
