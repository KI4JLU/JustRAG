import React, { useState } from 'react';
import { Check, Copy, Hash, Link2, Type } from 'lucide-react';
import { Button, cn } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { copyToClipboard } from '../../utils/clipboard';
import { lookupKey } from '../../hooks/useSheetRows';
import { formatCell, rowToJson, rowToMarkdown } from '../../utils/tableFormat';
import type { ViewColumn, ViewRow } from './types';

interface RowDetailProps {
    /** Every column of the sheet, hidden (empty) ones included. */
    columns: ViewColumn[];
    row: ViewRow;
    sheetName: string;
    /** `grid` under the row (fields side by side), `list` in the side panel. */
    layout: 'grid' | 'list';
    /** Opens a linked lookup table's tab. */
    onOpenTable: (table: string) => void;
}

/**
 * The full record of one row: every column (empty ones dimmed) with its
 * label (the SQL name only as tooltip — the column header already shows it)
 * and the complete value, the source line, and copy-as-JSON /
 * copy-as-Markdown. Shared by the inline detail row and the side panel.
 */
export const RowDetail: React.FC<RowDetailProps> = ({ columns, row, sheetName, layout, onOpenTable }) => {
    const { t, language } = useTheme();
    const locale = language === 'de' ? 'de-DE' : 'en-US';
    const [copied, setCopied] = useState<'json' | 'md' | null>(null);
    const names = columns.map(c => c.name);

    const copy = (kind: 'json' | 'md') => {
        const text = kind === 'json' ? rowToJson(names, row.cells) : rowToMarkdown(names, row.cells);
        void copyToClipboard(text).then(ok => {
            if (!ok) return;
            setCopied(kind);
            window.setTimeout(() => setCopied(c => (c === kind ? null : c)), 1400);
        });
    };

    return (
        <div className="flex flex-col gap-4">
            <dl className={cn('m-0 grid gap-x-6 gap-y-3', layout === 'grid' ? 'grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]' : 'grid-cols-1')}>
                {columns.map((col, i) => {
                    const value = row.cells[i] ?? null;
                    const Icon = col.kind === 'number' ? Hash : Type;
                    const name = col.lookup?.kind === 'code' && value !== null ? col.lookup.labels?.get(lookupKey(value)) : undefined;
                    return (
                        <div key={col.name} className={cn('min-w-0 border-l-2 border-outline-variant pl-3', col.empty && 'opacity-60')}>
                            <dt className="flex items-center gap-1.5 text-xs font-medium text-on-surface-variant" title={col.name}>
                                <Icon className="size-3 shrink-0" aria-hidden="true" />
                                {col.label}
                            </dt>
                            <dd className={cn('m-0 mt-1 text-sm wrap-anywhere text-on-surface', col.kind === 'number' && 'tabular-nums')}>
                                {value === null
                                    ? <span className="italic text-on-surface-variant/60">{t('tpNullDetail')}</span>
                                    : formatCell(value, col.kind, col.decimals, locale)}
                                {name !== undefined && <span className="text-on-surface-variant"> · {name}</span>}
                                {col.lookup && (
                                    <Button
                                        variant="link"
                                        size="sm"
                                        className="ml-1 h-auto gap-1 p-0"
                                        onClick={() => onOpenTable(col.lookup!.table)}
                                    >
                                        <Link2 className="size-3" aria-hidden="true" />
                                        {col.lookup.sheet}{col.lookup.inferred && ` (${t('tpLookupInferred')})`}
                                    </Button>
                                )}
                            </dd>
                        </div>
                    );
                })}
            </dl>
            <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                <span className="mr-auto">
                    {t('tpSource').replace('{sheet}', sheetName).replace('{row}', String(row.id))}
                </span>
                <Button variant="ghost" size="sm" onClick={() => copy('json')}>
                    {copied === 'json' ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                    {t('tpCopyJson')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => copy('md')}>
                    {copied === 'md' ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                    {t('tpCopyMarkdown')}
                </Button>
            </div>
        </div>
    );
};
