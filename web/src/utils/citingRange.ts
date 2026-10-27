/*
 * The sentence a citation chip belongs to, as a DOM Range — for the CSS
 * Custom Highlight that marks, in the answer, the statement whose source the
 * source panel shows (the panel marks the passage; this marks the claim).
 *
 * A Range and not a <mark>: the answer is React-rendered Markdown, and
 * wrapping text nodes would fight React's reconciliation. A highlight paints
 * over the existing text without touching the DOM.
 *
 * The sentence runs from the end of the previous sentence — or the previous
 * chip, or the start of the block (paragraph, list item, cell) — up to the
 * chip. A sentence end directly before the chip ("…nötig." [1]) is the end of
 * the cited sentence itself, not the start of it, so it is skipped.
 */

const SENTENCE_END_RE = /[.!?]["'”“»)]?\s+/g;

/** Text nodes of `root` in document order, without the chips' own numbers. */
function textNodes(root: Node, chipSelector: string): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => ((n.parentElement?.closest(chipSelector)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const out: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
    return out;
}

const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

export function citingRange(chip: Element, blockSelector: string, chipSelector: string): Range | null {
    const block = chip.closest(blockSelector) ?? chip.parentElement;
    if (!block) return null;

    // The last chip before this one in the same block bounds the sentence.
    const prevChip = [...block.querySelectorAll(chipSelector)].filter(c => c !== chip && precedes(c, chip)).pop();
    const nodes = textNodes(block, chipSelector).filter(n => precedes(n, chip) && (!prevChip || precedes(prevChip, n)));
    if (nodes.length === 0) return null;

    // Where the sentence starts: after the last sentence end in the text
    // before the chip, ignoring one right at the chip.
    const joined = nodes.map(n => n.data).join('');
    const body = joined.replace(/[.!?]["'”“»)]?\s*$/, '');
    let start = 0;
    for (const m of body.matchAll(SENTENCE_END_RE)) start = (m.index ?? 0) + m[0].length;
    while (start < joined.length && /\s/.test(joined[start])) start++;
    if (start >= joined.length) return null;

    // Map the offset in the joined text back to a node and an offset in it.
    let offset = start;
    let startNode = nodes[0];
    for (const n of nodes) {
        if (offset <= n.data.length) { startNode = n; break; }
        offset -= n.data.length;
    }
    const range = document.createRange();
    range.setStart(startNode, Math.min(offset, startNode.data.length));
    range.setEndBefore(chip);
    return range;
}
