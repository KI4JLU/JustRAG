import { describe, it, expect } from 'vitest';
import { citingRange } from './citingRange';

const BLOCK = 'p, li';
const CHIP = '.citation-chip';

function render(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
}

// Oracle: the sentence a reader sees in front of each marker, by construction.
describe('citingRange', () => {
    it('spans the sentence before the chip, not the one before it', () => {
        const root = render('<p>Erster Satz. Zweiter Satz über Plone <button class="citation-chip">1</button>.</p>');
        const r = citingRange(root.querySelector(CHIP)!, BLOCK, CHIP);
        expect(r?.toString()).toBe('Zweiter Satz über Plone ');
    });

    it('keeps a sentence end right before the chip inside the sentence', () => {
        const root = render('<p>Eins. Zwei ist nötig. <button class="citation-chip">1</button></p>');
        expect(citingRange(root.querySelector(CHIP)!, BLOCK, CHIP)?.toString()).toBe('Zwei ist nötig. ');
    });

    it('starts after a previous chip in the same block', () => {
        const root = render('<p>A gilt <button class="citation-chip">1</button> und B gilt <button class="citation-chip">2</button>.</p>');
        const chips = root.querySelectorAll(CHIP);
        expect(citingRange(chips[1], BLOCK, CHIP)?.toString()).toBe('und B gilt ');
    });

    it('crosses inline markup within the block', () => {
        const root = render('<li><strong>Daniela</strong> – Dekanat FB 08 <button class="citation-chip">1</button></li>');
        expect(citingRange(root.querySelector(CHIP)!, BLOCK, CHIP)?.toString()).toBe('Daniela – Dekanat FB 08 ');
    });
});
