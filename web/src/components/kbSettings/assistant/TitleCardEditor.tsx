import { useId, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, Shimmer, Textarea } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { KbCategory } from '../../../types';
import { DESCRIPTION_MAX_LEN, TITLE_MAX_LEN, generateDescription } from './api';
import { CategoryDot } from '../../CategoryPill';
import { TitleCardFrame, TitleCardMeta } from './StartPageParts';
import { useAssistantSettings } from './useAssistantSettings';

/**
 * The title block in edit mode: it keeps its look, and category, title and
 * description become editable right inside it. The page's colour is not set
 * here: the start page glows in its category's colour. Under it, the
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
    const [generating, setGenerating] = useState<'idle' | 'busy' | 'error'>('idle');
    const titleId = useId();
    const descId = useId();
    const roId = useId();
    const draft = store.draft;
    if (!draft) return null;
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
                <label htmlFor={titleId} className="sr-only">{t('asstTitle')}</label>
                {/* Edited in place: the field takes its type from this wrapper. */}
                <div className="text-center text-2xl font-semibold leading-tight text-balance break-words hyphens-auto text-on-surface sm:text-3xl">
                    <Textarea
                        variant="editable"
                        id={titleId}
                        rows={1}
                        value={draft.title}
                        maxLength={TITLE_MAX_LEN}
                        readOnly={!store.canRename}
                        aria-invalid={!draft.title.trim()}
                        aria-describedby={!store.canRename ? roId : undefined}
                        onChange={(e) => store.update({ title: e.target.value.replace(/\n/g, '') })}
                        placeholder={t('asstTitlePlaceholder')}
                    />
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-on-surface-variant">
                    <Select value={draft.categoryId ?? '__none'} onValueChange={(v) => store.update({ categoryId: v === '__none' ? null : v })}>
                        <SelectTrigger aria-label={t('asstCategoryChange').replace('{name}', category?.name ?? t('asstNoCategory'))} variant="editable">
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
                <div className="mt-3 text-center text-sm leading-6 text-on-surface-variant">
                    <Textarea
                        variant="editable"
                        id={descId}
                        rows={2}
                        maxLength={DESCRIPTION_MAX_LEN}
                        value={draft.description ?? t('kbHeaderDefault')}
                        // Typing makes it the own description.
                        onChange={(e) => store.update({ description: e.target.value })}
                        placeholder={t('asstDescriptionPlaceholder')}
                    />
                </div>
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
