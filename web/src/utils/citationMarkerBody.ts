/* A citation marker that carries page text.

   The answer prompt asks for "[3]" and "[1, 2, 5]". A model that is also told
   to name the page writes it into the marker instead of beside it:
   "[5, S. 584]", "[5, S. 584; 8, S. 583]", "[3, p. 12-14]". Such a marker
   cites the same sources. Mirrors parseMarkerBody in
   go-backend/internal/chat/citation_marker.go — keep the two in step. */

// The grammar, source for source the one in citation_marker.go: no \s and no
// `i` flag, which RE2 and JavaScript read differently.
// The blanks a marker may hold: space, tab, no-break space, narrow no-break
// space, thin space.
const WS = String.raw`[ \t\u00a0\u202f\u2009]`;
const PAGE_KEYWORD = String.raw`(?:[Ss]\.?|[Ss]eiten?|[Pp]{1,2}\.?|[Pp]ages?|[Aa]bschn(?:itt|\.)|[Aa]bs\.|[Kk]ap(?:itel|\.)|[Ss]ections?|[Ss]ec\.|§§?)`;
const PAGE_UNIT = String.raw`\d+(?:\.\d+)*[a-zA-Z]?`;
const PAGE_SPEC = String.raw`${PAGE_UNIT}(?:${WS}*(?:[-–—/&]|bis|to|u\.|und|and)${WS}*${PAGE_UNIT})*(?:${WS}*[fF]{1,2}\.?)?`;

// "S. 584" — the page of the source named in the part before it.
const PAGE_PART_RE = new RegExp(`^${PAGE_KEYWORD}${WS}*${PAGE_SPEC}$`);
// "5 S. 584", "5: S. 584" — source and page in one part.
const SOURCE_PAGE_PART_RE = new RegExp(`^(\\d{1,4})${WS}*:?${WS}*${PAGE_KEYWORD}${WS}*${PAGE_SPEC}$`);
// "586", "586-588" — a further page after a page part.
const PAGE_SPEC_RE = new RegExp(`^${PAGE_SPEC}$`);
// A source number.
const NUMBER_RE = /^\d{1,4}$/;
// The plain number list, with the whitespace RE2's \s names.
const PLAIN_BODY_RE = /^\d+(?:[ \t\n\r\f]*,[ \t\n\r\f]*\d+)*$/;
const TRIM_RE = new RegExp(`^${WS}+|${WS}+$`, 'g');

/** The highest source number a marker can cite (maxCitationNumber in Go). */
const MAX_CITATION_NUMBER = 999_999_999;

/** The longest marker body with page text, in characters. */
export const MAX_ANNOTATED_MARKER_BODY = 160;

/**
 * The positive source numbers a marker body cites, or null when the body is
 * no citation ("2024 war ein gutes Jahr"). A body is a citation when it is
 * the plain number list or names at least one page.
 *
 * Parts are separated by "," and sources by ";". A bare number is a source,
 * except after a page part, where it is a further page ("5, S. 584, 586") —
 * unless a page part follows it, which makes it the next source
 * ("5, S. 584, 8, S. 583").
 */
export function parseMarkerBody(body: string): number[] | null {
    if (PLAIN_BODY_RE.test(body)) {
        return body.split(',').map(p => parseInt(p.trim(), 10)).filter(n => n > 0 && n <= MAX_CITATION_NUMBER);
    }
    if ([...body].length > MAX_ANNOTATED_MARKER_BODY) return null;
    const out: number[] = [];
    let hasPage = false;
    const add = (digits: string) => {
        const n = parseInt(digits, 10);
        if (n > 0) out.push(n);
    };
    for (const group of body.split(';')) {
        const parts = group.split(',').map(p => p.replace(TRIM_RE, ''));
        let hasSource = false;
        let inPages = false;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (NUMBER_RE.test(part)) {
                const nextIsPage = i + 1 < parts.length && PAGE_PART_RE.test(parts[i + 1]);
                if (inPages && !nextIsPage) continue; // a further page
                add(part);
                hasSource = true;
                inPages = false;
            } else if (PAGE_PART_RE.test(part)) {
                if (!hasSource) return null;
                inPages = true;
                hasPage = true;
            } else if (inPages && PAGE_SPEC_RE.test(part)) {
                // a further page range
            } else {
                const m = SOURCE_PAGE_PART_RE.exec(part);
                if (!m) return null;
                add(m[1]);
                hasSource = true;
                inPages = true;
                hasPage = true;
            }
        }
        if (!hasSource) return null;
    }
    // Numbers and separators only: "[1, 2; 3, 4]" is a matrix.
    return hasPage ? out : null;
}

/** A marker body only the page-text form explains — not the plain number
 *  list — that cites at least one source. */
export function isAnnotatedMarkerBody(body: string): boolean {
    if (PLAIN_BODY_RE.test(body)) return false;
    const nums = parseMarkerBody(body);
    return nums !== null && nums.length > 0;
}
