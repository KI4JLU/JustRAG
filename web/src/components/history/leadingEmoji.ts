/**
 * Splits a leading emoji (one grapheme: ZWJ sequences, skin tones, flags,
 * keycaps) off a chat title. Chat titles are generated as "🧪 Title", and
 * the emoji then serves as the card's icon instead of the generic glyph.
 */
const EMOJI_START = /^\p{Extended_Pictographic}|^\p{Regional_Indicator}|^[0-9#*]️?⃣/u;

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function splitLeadingEmoji(title: string): { emoji: string | null; text: string } {
    const trimmed = title.trimStart();
    if (!EMOJI_START.test(trimmed)) return { emoji: null, text: title };
    const first = segmenter
        ? segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? ''
        : Array.from(trimmed)[0];
    const text = trimmed.slice(first.length).trimStart();
    // A title that is only an emoji keeps it as text too, so the card is never blank.
    return { emoji: first, text: text || first };
}
