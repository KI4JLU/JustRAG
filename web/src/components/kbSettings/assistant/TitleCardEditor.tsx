import { useId, useState } from 'react';
import { Ban, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { Button, ColorField, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SettingsRow, Shimmer, Switch, cn } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { KbCategory } from '../../../types';
import { DESCRIPTION_MAX_LEN, TITLE_MAX_LEN, generateDescription, type StartColors } from './api';
import { CategoryDot } from '../../CategoryPill';
import { TitleCardFrame, TitleCardMeta } from './StartPageParts';
import { editableField, inlineSelectTrigger } from './editInPlace';
import { DEFAULT_COLORS, colorsStyle } from './startPageModel';
import { useAssistantSettings } from './useAssistantSettings';

/** A round swatch of the colours; without colours a dashed circle with a ban icon. */
function ColorsSwatch({ colors, className }: { colors: StartColors | null; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn('flex items-center justify-center rounded-full', !colors && 'border border-dashed border-outline bg-surface-container text-on-surface-variant [&_svg]:size-5', className)}
            style={colorsStyle(colors)}
        >
            {!colors && <Ban />}
        </span>
    );
}

/**
 * „Farben": whether the start page shows a gradient, and its two colours as
 * DS colour fields. Switching it off keeps the colours here, so switching it
 * back on returns them.
 */
function ColorsEditor({ value, onChange }: { value: StartColors | null; onChange: (c: StartColors | null) => void }) {
    const { t } = useTheme();
    const [last, setLast] = useState<StartColors>(value ?? DEFAULT_COLORS);
    const shown = value ?? last;
    const set = (c: StartColors) => { setLast(c); onChange(c); };
    const isDefault = shown.from === DEFAULT_COLORS.from && shown.to === DEFAULT_COLORS.to;
    return (
        <div className="flex w-80 max-w-full flex-col">
            <div className="h-10 rounded-[var(--ui-radius-control)]" style={colorsStyle(shown)} aria-hidden="true" />
            <SettingsRow
                label={t('asstColorsShow')}
                description={t('asstColorsShowHint')}
                control={<Switch aria-label={t('asstColorsShow')} checked={!!value} onCheckedChange={(on) => onChange(on ? last : null)} />}
            />
            <SettingsRow label={t('asstColorFrom')} control={<ColorField label={t('asstColorFrom')} value={shown.from} disabled={!value} onChange={(from: string) => set({ ...shown, from })} />} />
            <SettingsRow label={t('asstColorTo')} control={<ColorField label={t('asstColorTo')} value={shown.to} disabled={!value} onChange={(to: string) => set({ ...shown, to })} />} />
            <div className="pt-3">
                <Button variant="link" size="sm" className="h-auto p-0" disabled={!value || isDefault} onClick={() => set(DEFAULT_COLORS)}>
                    <RefreshCw className="size-3.5" aria-hidden="true" /> {t('asstColorsDefault')}
                </Button>
            </div>
        </div>
    );
}

/**
 * The title block in edit mode: it keeps its look, and category, title,
 * colour and description become editable right inside it. Under it, the
 * description can be written from the topic's documents — once, on request:
 * the text goes into the draft like a typed one and is kept by the save.
 */
export function TitleCardEditor({
    categories, fileCount, asOf,
}: {
    categories: KbCategory[];
    fileCount?: number;
    asOf?: string;
}) {
    const { t, language: uiLanguage } = useTheme();
    const store = useAssistantSettings();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [generating, setGenerating] = useState<'idle' | 'busy' | 'error'>('idle');
    const titleId = useId();
    const descId = useId();
    const roId = useId();
    const draft = store.draft;
    if (!draft) return null;
    const colors = draft.startPage.colors;
    const category = categories.find(c => c.id === draft.categoryId) ?? null;
    const ownDescription = draft.description !== null;
    const hasDocs = (fileCount ?? 0) > 0;
    const generate = async () => {
        setGenerating('busy');
        try {
            const description = await generateDescription(store.kb.id, draft.title.trim(), store.catalog?.language ?? uiLanguage);
            store.update({ description: description.slice(0, DESCRIPTION_MAX_LEN) });
            setGenerating('idle');
        } catch {
            setGenerating('error');
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <TitleCardFrame>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                        {/* eslint-disable-next-line design-system/no-raw-ui-elements -- an avatar-size swatch with a pencil badge opens the picker; no DS swatch trigger */}
                        <button
                            type="button"
                            aria-label={t('asstColorsChange')}
                            className="group absolute -right-14 top-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                        >
                            <ColorsSwatch colors={colors} className="size-10 ring-2 ring-surface-container-lowest shadow-card transition-transform group-hover:scale-105" />
                            <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest text-on-surface shadow-card [&_svg]:size-3">
                                <Pencil />
                            </span>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-auto p-4">
                        <div className="mb-3 text-sm font-medium text-on-surface">{t('asstColors')}</div>
                        <ColorsEditor value={colors} onChange={(c) => store.updateStartPage(p => ({ ...p, colors: c }))} />
                    </PopoverContent>
                </Popover>

                <label htmlFor={titleId} className="sr-only">{t('asstTitle')}</label>
                <textarea
                    id={titleId}
                    rows={1}
                    value={draft.title}
                    maxLength={TITLE_MAX_LEN}
                    readOnly={!store.canRename}
                    aria-invalid={!draft.title.trim()}
                    aria-describedby={!store.canRename ? roId : undefined}
                    onChange={(e) => store.update({ title: e.target.value.replace(/\n/g, '') })}
                    placeholder={t('asstTitlePlaceholder')}
                    className={cn(editableField, 'text-center text-2xl font-semibold leading-tight text-balance break-words hyphens-auto text-on-surface sm:text-3xl', !store.canRename && 'outline-none hover:outline-none')}
                />

                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-on-surface-variant">
                    <Select value={draft.categoryId ?? '__none'} onValueChange={(v) => store.update({ categoryId: v === '__none' ? null : v })}>
                        <SelectTrigger aria-label={t('asstCategoryChange').replace('{name}', category?.name ?? t('asstNoCategory'))} className={inlineSelectTrigger}>
                            <div className="inline-flex items-center gap-1.5">
                                {category && <CategoryDot category={category} />} {category?.name ?? t('asstNoCategory')}
                            </div>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__none">{t('asstNoCategory')}</SelectItem>
                            {categories.map(c => (
                                <SelectItem key={c.id} value={c.id}>
                                    <span className="flex items-center gap-2"><CategoryDot category={c} /> {c.name}</span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <TitleCardMeta fileCount={fileCount} asOf={asOf} />
                </div>

                <label htmlFor={descId} className="sr-only">{t('asstDescription')}</label>
                <textarea
                    id={descId}
                    rows={2}
                    maxLength={DESCRIPTION_MAX_LEN}
                    value={draft.description ?? t('kbHeaderDefault')}
                    // Typing makes it the own description.
                    onChange={(e) => store.update({ description: e.target.value })}
                    placeholder={t('asstDescriptionPlaceholder')}
                    className={cn(editableField, 'mt-3 text-center text-sm leading-6 text-on-surface-variant')}
                />
            </TitleCardFrame>

            {/* The description's status, outside the card so it never competes with the page. */}
            <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-on-surface-variant">
                {ownDescription ? (
                    <>
                        <span>{t('asstOwnDescriptionCount').replace('{n}', String(draft.description?.length ?? 0)).replace('{max}', String(DESCRIPTION_MAX_LEN))}</span>
                        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => store.update({ description: null })}>
                            <RefreshCw className="size-3.5" aria-hidden="true" /> {t('asstUseDefaultDescription')}
                        </Button>
                    </>
                ) : (
                    <span>{t('asstDefaultDescriptionHint')}</span>
                )}
                {/* Until an agent writes it on ingest: written on request. */}
                <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    disabled={generating === 'busy' || !hasDocs}
                    title={hasDocs ? undefined : t('asstGenerateDescriptionNoDocs')}
                    onClick={() => void generate()}
                >
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    {generating === 'busy' ? <Shimmer className="m-0">{t('asstDescribeBusy')}</Shimmer> : t('asstGenerateDescription')}
                </Button>
            </div>
            {generating === 'error' && <p role="alert" className="m-0 px-1 text-sm text-error">{t('asstGenerateDescriptionFailed')}</p>}
            {!draft.title.trim() && <p className="m-0 px-1 text-sm text-error">{t('asstTitleRequired')}</p>}
            {!store.canRename && <p id={roId} className="m-0 px-1 text-xs text-on-surface-variant">{t('asstTitleReadOnly')}</p>}
        </div>
    );
}
