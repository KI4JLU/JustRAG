import React from 'react';
import { Check, PanelRight, Rows3, SlidersHorizontal } from 'lucide-react';
import {
    Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import type { DetailMode } from './types';

interface ViewMenuProps {
    emptyRows: number;
    showEmptyRows: boolean;
    onShowEmptyRows: (show: boolean) => void;
    emptyColumns: number;
    showEmptyCols: boolean;
    onShowEmptyCols: (show: boolean) => void;
    detailMode: DetailMode;
    onDetailMode: (mode: DetailMode) => void;
}

/**
 * The toolbar's one "Ansicht" (view) menu, built like the DS `FilterMenu`
 * (sm trigger — ghost here, like every control in the PdfViewer-style
 * toolbar strip — "(angepasst)" once anything differs from the
 * default, a check on the chosen items): empty rows / columns on or off —
 * each offered only when there is something to show — and the row-details
 * layout. The DS dropdown has no checkbox/radio items yet, so plain items
 * carry `menuitemcheckbox` / `menuitemradio` + `aria-checked`; a toggle keeps
 * the menu open (preventDefault on select) so both can be set in one go.
 */
export const ViewMenu: React.FC<ViewMenuProps> = ({
    emptyRows, showEmptyRows, onShowEmptyRows, emptyColumns, showEmptyCols, onShowEmptyCols, detailMode, onDetailMode,
}) => {
    const { t } = useTheme();
    const customised = showEmptyRows || showEmptyCols || detailMode !== 'inline';
    const check = (on: boolean) => on && <Check className="ml-auto size-4" aria-hidden="true" />;
    const count = (n: number) => <span className="ml-auto tabular-nums text-on-surface-variant">{n}</span>;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                    <SlidersHorizontal className="size-4" aria-hidden="true" />
                    {t('tpView')}
                    {customised && <span>({t('tpViewCustomised')})</span>}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                {(emptyRows > 0 || emptyColumns > 0) && (
                    <>
                        <DropdownMenuLabel>{t('tpViewShow')}</DropdownMenuLabel>
                        {emptyRows > 0 && (
                            <DropdownMenuItem
                                role="menuitemcheckbox"
                                aria-checked={showEmptyRows}
                                selected={showEmptyRows}
                                onSelect={(e) => { e.preventDefault(); onShowEmptyRows(!showEmptyRows); }}
                            >
                                {t('tpViewEmptyRows')}
                                {count(emptyRows)}
                                {check(showEmptyRows)}
                            </DropdownMenuItem>
                        )}
                        {emptyColumns > 0 && (
                            <DropdownMenuItem
                                role="menuitemcheckbox"
                                aria-checked={showEmptyCols}
                                selected={showEmptyCols}
                                onSelect={(e) => { e.preventDefault(); onShowEmptyCols(!showEmptyCols); }}
                            >
                                {t('tpViewEmptyCols')}
                                {count(emptyColumns)}
                                {check(showEmptyCols)}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                    </>
                )}
                <DropdownMenuLabel>{t('tpDetails')}</DropdownMenuLabel>
                {([
                    ['inline', t('tpDetailsInline'), Rows3],
                    ['panel', t('tpDetailsPanel'), PanelRight],
                ] as const).map(([mode, label, Icon]) => (
                    <DropdownMenuItem
                        key={mode}
                        role="menuitemradio"
                        aria-checked={detailMode === mode}
                        selected={detailMode === mode}
                        onSelect={() => onDetailMode(mode)}
                    >
                        <Icon className="size-4" aria-hidden="true" />
                        {label}
                        {check(detailMode === mode)}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
