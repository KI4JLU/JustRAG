// Math in chat answers is rendered by remark-math + rehype-katex, which only
// know the dollar delimiters. LLMs just as often emit the LaTeX forms
// \( … \) and \[ … \]; markdown reads those backslashes as escapes and prints
// bare parentheses/brackets, so they are rewritten to dollars first.

// Fenced blocks first, then inline code — the same shapes the citation
// rewriter in MessageContent preserves.
const CODE_RE = /```[\s\S]*?```|`[^`\n]+`/g;

// Math spans in dollar form, display before inline. Exported so the citation
// and flagged-claim rewriters can leave math alone: `$v[1]$` is an index, not
// a source reference, and HTML injected into a formula breaks it.
export const MATH_SPAN_RE = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g;

// \[1\] and \[1, 2\] are escaped citation markers (MessageContent's citation
// regex accepts them), not display math.
const CITATION_BODY_RE = /^\s*\d{1,3}(?:\s*,\s*\d{1,3})*\s*$/;

export function normalizeMathDelimiters(content: string): string {
    if (!content.includes('\\(') && !content.includes('\\[')) return content;

    const preserved: string[] = [];
    const placeholder = (i: number) => `\x00MATH_PRESERVE_${i}\x00`;
    let safe = content.replace(CODE_RE, (match) => {
        preserved.push(match);
        return placeholder(preserved.length - 1);
    });

    safe = safe.replace(/\\\[([\s\S]+?)\\\]/g, (match, body: string) =>
        CITATION_BODY_RE.test(body) ? match : `\n\n$$\n${body.trim()}\n$$\n\n`);
    safe = safe.replace(/\\\(([^\n]+?)\\\)/g, (_match, body: string) => `$${body.trim()}$`);
    // A display block that already sat on its own lines picks up extra blank
    // lines from the padding above; markdown would ignore them, but keep the
    // output tidy.
    safe = safe.replace(/\n{3,}/g, '\n\n');

    for (let i = 0; i < preserved.length; i++) {
        safe = safe.replace(placeholder(i), () => preserved[i]);
    }
    return safe;
}
