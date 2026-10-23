/* Raw HTML inside a stored Markdown source (an RSS item's full text keeps
   bits of the page's markup, often indented, which Markdown reads as a code
   block) turned into Markdown the viewer can render. The viewer's editor
   shows any tag it has no node for (section, picture, img …) as literal
   text, and the app's CSP blocks external images anyway — so the HTML is
   rendered to its readable content: text, links, emphasis, headings, lists,
   and an image as its alt text. */

// A block starts with a tag at the start of a line (any indentation) and runs
// to the next blank line — CommonMark's HTML block, minus the indentation
// rule that turns an indented one into code.
const HTML_START_RE = /^\s*<\/?[a-zA-Z][\w-]*(?:\s|>|\/>|$)/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'figure', 'figcaption', 'blockquote', 'table', 'tr', 'ul', 'ol', 'pre']);

// Text from the HTML is literal: Markdown metacharacters in it are escaped,
// so only the syntax this converter writes (bold, links …) formats.
const escapeInline = (t: string) => t.replace(/([\\`*_[\]<>|])/g, '\\$1');
// A paragraph that happens to start like a heading, list item or quote stays a paragraph.
const escapeLead = (t: string) => t.replace(/^([#>+-]|\d+[.)])(?=\s)/, '\\$1');

function inline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeInline((node.textContent ?? '').replace(/\s+/g, ' '));
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const inner = () => [...el.childNodes].map(inline).join('');
    switch (tag) {
        case 'script': case 'style': case 'source': return '';
        case 'br': return '  \n';
        case 'img': {
            const alt = el.getAttribute('alt')?.trim();
            return alt ? `*${alt}*` : '';
        }
        case 'strong': case 'b': { const t = inner().trim(); return t ? `**${t}**` : ''; }
        case 'em': case 'i': { const t = inner().trim(); return t ? `*${t}*` : ''; }
        case 'code': {
            // A code span's text as written (no escaping inside backticks).
            const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!t) return '';
            const ticks = '`'.repeat(Math.max(1, ...[...t.matchAll(/`+/g)].map(m => m[0].length + 1)));
            return `${ticks}${t.includes('`') ? ` ${t} ` : t}${ticks}`;
        }
        case 'a': {
            const t = inner().trim();
            const href = el.getAttribute('href');
            return t && href && /^https?:\/\//.test(href) ? `[${t}](${href})` : t;
        }
        default: return inner();
    }
}

function blocks(node: Node, out: string[]): void {
    if (node.nodeType !== Node.ELEMENT_NODE) {
        const t = inline(node).trim();
        if (t) out.push(t);
        return;
    }
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'pre') {
        // Preformatted: the text as written, as a fenced block.
        const code = (el.textContent ?? '').replace(/\n$/, '');
        if (code.trim()) {
            const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`{3,}/g)].map(m => m[0].length + 1)));
            out.push(`${fence}\n${code}\n${fence}`);
        }
        return;
    }
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
        const t = inline(el).trim();
        if (t) out.push(`${'#'.repeat(Number(heading[1]))} ${t}`);
        return;
    }
    if (tag === 'table') {
        const md = tableToMarkdown(el);
        if (md) out.push(md);
        return;
    }
    if (tag === 'li') {
        const t = inline(el).trim();
        if (t) out.push(`- ${t}`);
        return;
    }
    const hasBlockChild = [...el.children].some(c => BLOCK_TAGS.has(c.tagName.toLowerCase()) || /^h[1-6]$|^li$/.test(c.tagName.toLowerCase()));
    if (!hasBlockChild) {
        const t = inline(el).trim();
        if (t) out.push(escapeLead(t));
        return;
    }
    // Mixed content: inline runs between block children become paragraphs.
    let run = '';
    const flush = () => { if (run.trim()) out.push(escapeLead(run.trim())); run = ''; };
    for (const child of el.childNodes) {
        const childTag = child.nodeType === Node.ELEMENT_NODE ? (child as Element).tagName.toLowerCase() : '';
        if (BLOCK_TAGS.has(childTag) || /^h[1-6]$|^li$/.test(childTag)) { flush(); blocks(child, out); }
        else run += inline(child);
    }
    flush();
}

/** A table as a GFM table: the first row is the header, `|` in a cell escaped. */
function tableToMarkdown(table: Element): string {
    const rows = [...table.querySelectorAll('tr')]
        .map(tr => [...tr.children]
            .filter(c => /^t[dh]$/i.test(c.tagName))
            // inline() already escapes a literal `|` (escapeInline).
            .map(c => inline(c).trim()))
        .filter(r => r.length > 0);
    if (rows.length === 0) return '';
    const width = Math.max(...rows.map(r => r.length));
    const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
    return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

/** One HTML block rendered to Markdown paragraphs ('' when it holds nothing readable). */
export function htmlBlockToMarkdown(html: string): string {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const out: string[] = [];
    blocks(doc.body, out);
    return out.join('\n\n');
}

/** Replaces every raw HTML block of a Markdown text (outside code fences) with its rendered Markdown. */
export function renderHtmlBlocks(markdown: string): string {
    if (typeof DOMParser === 'undefined' || !markdown.includes('<')) return markdown;
    const lines = markdown.split('\n');
    const out: string[] = [];
    // The open fence's marker: it closes only on the same character, at least
    // as long (CommonMark), so a ```` fence can show a ``` one inside it.
    let fence: string | null = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const marker = FENCE_RE.exec(line)?.[1];
        if (marker) {
            if (fence === null) fence = marker;
            else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
            out.push(line);
            continue;
        }
        if (fence !== null || !HTML_START_RE.test(line)) { out.push(line); continue; }
        // To the next blank line — but an open <pre> runs to its closing tag,
        // blank lines included (CommonMark's HTML block kind 1).
        const block: string[] = [];
        let openPre = 0;
        while (i < lines.length && (openPre > 0 || lines[i].trim() !== '')) {
            openPre += (lines[i].match(/<pre[\s>]/gi)?.length ?? 0) - (lines[i].match(/<\/pre>/gi)?.length ?? 0);
            block.push(lines[i++]);
        }
        i -= 1;
        const md = htmlBlockToMarkdown(block.join('\n'));
        if (md) out.push(md);
    }
    return out.join('\n');
}
