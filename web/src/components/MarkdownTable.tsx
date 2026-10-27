import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Download, Maximize2 } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { exportRowsToXlsx } from '../utils/exportXlsx';

// Lazy: the preview (SheetTable, row details) loads on the first "Maximize",
// not with every chat answer.
const LocalTablePreviewDialog = lazy(() => import('./tablePreview/LocalTablePreviewDialog').then(module => ({ default: module.LocalTablePreviewDialog })));

// Minimal hast (HTML AST) node shape — react-markdown passes the parsed node
// for each rendered element via the `node` prop.
interface HastNode {
    type?: string;
    tagName?: string;
    value?: string;
    properties?: { className?: string[] | string };
    children?: HastNode[];
}

interface Props {
    node?: HastNode;
    children?: React.ReactNode;
    filename: string;
}

function hasClass(node: HastNode, name: string): boolean {
    const cls = node.properties?.className;
    if (Array.isArray(cls)) return cls.includes(name);
    if (typeof cls === 'string') return cls.split(/\s+/).includes(name);
    return false;
}

// Residual inline citation markers the LLM may emit as literal text inside a
// cell ("[1]", "[1, 2]", "[S. 4]") rather than the rendered source-ref sup.
const CITATION_TEXT_RE = /\[\s*(?:S\.\s*)?\d+(?:\s*[,–-]\s*\d+)*\s*\]/g;

// Elements that break a line: their text is set off by a space, so
// "First<br>Second" reads "First Second", not "FirstSecond".
const LINE_BREAKING = new Set(['br', 'p', 'div', 'li', 'ul', 'ol']);

// textOf flattens a node's text, skipping rendered citation markers
// (sup.source-ref injected by addCitationRefs) so they never reach the export.
// cleanCell collapses the spaces line breaks leave.
function textOf(node?: HastNode): string {
    if (!node) return '';
    if (node.type === 'text') return node.value ?? '';
    if (node.tagName === 'sup' && hasClass(node, 'source-ref')) return '';
    const text = (node.children ?? []).map(textOf).join('');
    return node.tagName && LINE_BREAKING.has(node.tagName) ? ` ${text} ` : text;
}

function cleanCell(node: HastNode): string {
    return textOf(node).replace(CITATION_TEXT_RE, '').replace(/\s+/g, ' ').trim();
}

// extractRows walks the table AST and returns a row-major array of cleaned cell
// strings (header row included). Whitespace-only text nodes between elements are
// skipped because they are not `tr`/`td`/`th` nodes.
function extractRows(table?: HastNode): string[][] {
    const rows: string[][] = [];
    const walk = (n?: HastNode) => {
        if (!n) return;
        if (n.tagName === 'tr') {
            const cells = (n.children ?? []).filter((c) => c.tagName === 'th' || c.tagName === 'td');
            rows.push(cells.map(cleanCell));
            return;
        }
        (n.children ?? []).forEach(walk);
    };
    walk(table);
    return rows;
}

// headerRow reports whether the table's first row is a header (all `th`).
// A GFM table always has one; a raw-HTML table in an answer (rehype-raw) may
// not, and then its first row is data.
function headerRow(table?: HastNode): boolean {
    let first: HastNode | undefined;
    const find = (n?: HastNode) => {
        if (!n || first) return;
        if (n.tagName === 'tr') { first = n; return; }
        (n.children ?? []).forEach(find);
    };
    find(table);
    const cells = (first?.children ?? []).filter((c) => c.tagName === 'th' || c.tagName === 'td');
    return cells.length > 0 && cells.every((c) => c.tagName === 'th');
}

// MarkdownTable renders a GFM table and, when it has extractable rows, a
// footer under it: the table's size, an icon-only "Download .xlsx" and a
// "Maximize" that opens the table in the table preview (sort, search, row
// details, full screen) — big tables otherwise only scroll inside the
// answer. Icon-only buttons carry their label as tooltip and accessible name.
// It is wired as the ReactMarkdown `table` component override so EVERY table
// in an AI answer gets the footer — not just the corpus-comparison
// StructuredTable (which has its own dedicated view). The footer is always
// shown, never on hover only: the message list is virtualized, and a strip
// that appears on hover would change the item's height under the pointer.
export function MarkdownTable({ node, children, filename }: Props) {
    const { t, language } = useTheme();
    const locale = language === 'de' ? 'de-DE' : 'en-US';
    const [maximized, setMaximized] = useState(false);

    const cells = useMemo(() => extractRows(node), [node]);
    const hasHeader = useMemo(() => headerRow(node), [node]);
    const exportXlsx = useCallback(() => {
        void exportRowsToXlsx(cells, { filename });
    }, [cells, filename]);

    const rowCount = hasHeader ? Math.max(0, cells.length - 1) : cells.length;
    const colCount = cells[0]?.length ?? 0;
    const plural = (one: string, many: string, n: number) => (n === 1 ? t(one) : t(many).replace('{count}', n.toLocaleString(locale)));
    const downloadLabel = t('mdTableDownloadXlsx');
    const maximizeLabel = t('mdTableMaximize');

    return (
        <div className="md-table-frame">
            <div className="md-table">
                <table>{children}</table>
            </div>
            {cells.length > 0 && (
                <div className="md-table-frame__footer">
                    <span className="md-table-frame__size">
                        {plural('mdTableRowsOne', 'mdTableRowsMany', rowCount)} · {plural('mdTableColsOne', 'mdTableColsMany', colCount)}
                    </span>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label={downloadLabel} onClick={exportXlsx}>
                                <Download size={16} aria-hidden="true" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{downloadLabel}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label={maximizeLabel} aria-haspopup="dialog" onClick={() => setMaximized(true)}>
                                <Maximize2 size={16} aria-hidden="true" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{maximizeLabel}</TooltipContent>
                    </Tooltip>
                </div>
            )}
            {maximized && (
                <Suspense fallback={null}>
                    <LocalTablePreviewDialog cells={cells} hasHeader={hasHeader} onDownload={exportXlsx} onClose={() => setMaximized(false)} />
                </Suspense>
            )}
        </div>
    );
}
