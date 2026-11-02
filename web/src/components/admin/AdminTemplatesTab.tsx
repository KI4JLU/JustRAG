import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { ArrowDown, ArrowUp, Ban, Pencil, Plus, Save, Star, Trash2, Undo2 } from 'lucide-react';
import {
    Badge, BreadcrumbBack, Button, ColorField, Notice, SegmentedControl, SettingsRow, Switch, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useModalContext } from '../../contexts/ModalContext';
import { FieldRow, TextareaFieldRow } from '../form/SettingsFieldRow';
import { IconTile, RoleIcon } from '../kbSettings/assistant/roles';
import AdminCategoriesSection from './AdminCategoriesSection';
import { AdminListCard } from './AdminListCard';
import {
    TEMPLATE_ICONS, TEMPLATE_LIMITS, canSaveTemplate, createTemplate, deleteTemplate, emptyTemplate, inputOf,
    listTemplates, reorderTemplates, updateTemplate, type RoleTemplate, type TemplateInput,
} from './roleTemplatesApi';

type Lang = 'de' | 'en';

/** The server's reason for a refused write (a 400's `error`), else the generic line. */
function reason(err: unknown, fallback: string): string {
    if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: string } | undefined)?.error;
        if (msg) return msg;
    }
    return fallback;
}

/** The cover band of a role's start page card, with its icon on the edge. */
function CoverPreview({ cover, icon }: { cover: TemplateInput['cover']; icon: string }) {
    return (
        <div className="relative mb-5 h-16 w-full max-w-sm rounded-xl" style={{ backgroundImage: `linear-gradient(120deg, ${cover.from}, ${cover.to})` }}>
            <span className="absolute -bottom-5 left-4 rounded-[14px] bg-surface p-1">
                <IconTile icon={icon} tone="solid" />
            </span>
        </div>
    );
}

/**
 * „Vorlagen": what topics are built from — the template roles every topic can
 * use (GET/POST/PUT/DELETE /api/admin/role-templates) and the catalog
 * categories (moved here from „Globale KBs").
 */
export default function AdminTemplatesTab({ footerSlot }: { footerSlot: HTMLElement | null }) {
    const { t } = useTheme();
    const [tab, setTab] = useState('roles');
    return (
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-6">
            <TabsList>
                <TabsTrigger value="roles">{t('tplTabRoles')}</TabsTrigger>
                <TabsTrigger value="categories">{t('categories')}</TabsTrigger>
            </TabsList>
            <TabsContent value="roles"><RoleTemplatesPanel footerSlot={tab === 'roles' ? footerSlot : null} /></TabsContent>
            <TabsContent value="categories"><AdminCategoriesSection /></TabsContent>
        </Tabs>
    );
}

function RoleTemplatesPanel({ footerSlot }: { footerSlot: HTMLElement | null }) {
    const { t, language } = useTheme();
    const toast = useToast();
    const { showConfirm } = useModalContext();
    const [templates, setTemplates] = useState<RoleTemplate[] | null>(null);
    const [failed, setFailed] = useState(false);
    // The sub-view: a new template (id null) or one being edited.
    const [editing, setEditing] = useState<{ id: string | null; draft: TemplateInput } | null>(null);

    useEffect(() => {
        listTemplates().then(setTemplates).catch(() => setFailed(true));
    }, []);

    const run = async (write: () => Promise<RoleTemplate[]>, fallback: string) => {
        try {
            setTemplates(await write());
            return true;
        } catch (err) {
            toast.error(reason(err, fallback));
            return false;
        }
    };

    const name = (r: RoleTemplate) => (language === 'en' && r.name.en.trim()) || r.name.de;

    if (editing) {
        return (
            <TemplateEditor
                draft={editing.draft}
                isNew={editing.id === null}
                lockedDefault={editing.id !== null && !!templates?.find(r => r.id === editing.id)?.isDefault}
                setDraft={(draft) => setEditing({ ...editing, draft })}
                onBack={() => setEditing(null)}
                onSave={async () => {
                    const ok = await run(
                        () => (editing.id === null ? createTemplate(editing.draft) : updateTemplate(editing.id, editing.draft)),
                        t('tplSaveError'),
                    );
                    if (ok) setEditing(null);
                }}
                footerSlot={footerSlot}
            />
        );
    }

    if (failed) return <Notice tone="warning">{t('tplLoadError')}</Notice>;
    if (!templates) return <p className="m-0 text-on-surface-variant">{t('loading')}</p>;

    const move = (i: number, by: -1 | 1) => {
        const ids = templates.map(r => r.id);
        [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
        void run(() => reorderTemplates(ids), t('tplSaveError'));
    };

    return (
        <div className="flex flex-col gap-3">
            <p className="m-0 text-sm text-on-surface-variant">{t('tplRolesIntro')}</p>
            {templates.map((r, i) => (
                <AdminListCard
                    key={r.id}
                    accent={r.isDefault}
                    title={(
                        <span className="flex items-center gap-3">
                            <span aria-hidden="true" className="size-8 shrink-0 rounded-lg" style={{ backgroundImage: `linear-gradient(120deg, ${r.cover.from}, ${r.cover.to})` }}>
                                <RoleIcon name={r.icon} className="m-2 size-4 text-white" />
                            </span>
                            {name(r)}
                        </span>
                    )}
                    badge={r.isDefault
                        ? <Badge tone="primary">{t('tplDefault')}</Badge>
                        : !r.enabled ? <Badge tone="neutral">{t('tplDisabled')}</Badge> : undefined}
                    details={[
                        (language === 'en' && r.description.en.trim()) || r.description.de || t('tplNoDescription'),
                        r.usedBy === 1 ? t('tplUsedByOne') : t('tplUsedBy').replace('{n}', String(r.usedBy)),
                    ]}
                    actionsLabel={t('tplActionsFor').replace('{name}', name(r))}
                    actions={[
                        { label: t('edit'), icon: <Pencil className="size-4" />, onSelect: () => setEditing({ id: r.id, draft: inputOf(r) }) },
                        {
                            label: t('tplMakeDefault'), icon: <Star className="size-4" />, disabled: r.isDefault || !r.enabled,
                            onSelect: () => void run(() => updateTemplate(r.id, { ...inputOf(r), isDefault: true }), t('tplSaveError')),
                        },
                        r.enabled
                            ? {
                                label: t('tplDisable'), icon: <Ban className="size-4" />, disabled: r.isDefault,
                                onSelect: () => void run(() => updateTemplate(r.id, { ...inputOf(r), enabled: false }), t('tplSaveError')),
                            }
                            : {
                                label: t('tplEnable'), icon: <Undo2 className="size-4" />,
                                onSelect: () => void run(() => updateTemplate(r.id, { ...inputOf(r), enabled: true }), t('tplSaveError')),
                            },
                        { label: t('asstMoveForward'), icon: <ArrowUp className="size-4" />, disabled: i === 0, separatorBefore: true, onSelect: () => move(i, -1) },
                        { label: t('asstMoveBack'), icon: <ArrowDown className="size-4" />, disabled: i === templates.length - 1, onSelect: () => move(i, 1) },
                        {
                            // A role topics use cannot go: disabling stops new picks without breaking them.
                            label: r.usedBy > 0 ? t('tplDeleteInUse') : t('delete'), icon: <Trash2 className="size-4" />, destructive: true, separatorBefore: true,
                            disabled: r.isDefault || r.usedBy > 0,
                            onSelect: async () => {
                                if (!await showConfirm(t('tplDeleteConfirm').replace('{name}', name(r)))) return;
                                void run(() => deleteTemplate(r.id), t('tplDeleteError'));
                            },
                        },
                    ]}
                />
            ))}
            {footerSlot && createPortal(
                <Button onClick={() => setEditing({ id: null, draft: emptyTemplate() })}>
                    <Plus size={16} aria-hidden="true" /> {t('tplAdd')}
                </Button>,
                footerSlot,
            )}
        </div>
    );
}

function TemplateEditor({
    draft, isNew, lockedDefault, setDraft, onBack, onSave, footerSlot,
}: {
    draft: TemplateInput;
    isNew: boolean;
    /** The default being edited: it stays the default until another role takes it. */
    lockedDefault: boolean;
    setDraft: (d: TemplateInput) => void;
    onBack: () => void;
    onSave: () => Promise<void>;
    footerSlot: HTMLElement | null;
}) {
    const { t } = useTheme();
    const formId = useId();
    const [lang, setLang] = useState<Lang>('de');
    const [busy, setBusy] = useState(false);
    const text = (field: 'name' | 'description' | 'prompt', value: string) => setDraft({ ...draft, [field]: { ...draft[field], [lang]: value } });
    // English is optional: empty, it reads the German text.
    const enHint = lang === 'en' ? t('tplEnglishFallback') : undefined;

    const actions = (
        <>
            <Button type="button" variant="outline" onClick={onBack}>{t('cancel')}</Button>
            <Button type="submit" form={formId} disabled={busy || !canSaveTemplate(draft)}>
                <Save size={18} aria-hidden="true" /> {t('save')}
            </Button>
        </>
    );

    return (
        <form
            id={formId}
            className="flex flex-col gap-6"
            onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                    await onSave();
                } finally {
                    setBusy(false);
                }
            }}
        >
            <div className="flex min-w-0 flex-col gap-1.5">
                <BreadcrumbBack trail={[t('adminTabTemplates'), t('tplTabRoles')]} labels={{ nav: t('breadcrumbNav'), back: t('backTo') }} onClick={onBack} />
                <h3 className="m-0 text-lg font-semibold text-on-surface">{isNew ? t('tplNew') : t('tplEdit')}</h3>
            </div>

            <div className="flex flex-col gap-3">
                <span className="text-sm font-medium text-on-surface">{t('tplLook')}</span>
                <CoverPreview cover={draft.cover} icon={draft.icon} />
                <div role="radiogroup" aria-label={t('tplIcon')} className="flex flex-wrap gap-1.5">
                    {TEMPLATE_ICONS.map(icon => (
                        <Button
                            key={icon}
                            type="button"
                            role="radio"
                            aria-checked={draft.icon === icon}
                            aria-label={t(`tplIcon_${icon}`)}
                            variant={draft.icon === icon ? 'default' : 'outline'}
                            size="icon"
                            onClick={() => setDraft({ ...draft, icon })}
                        >
                            <RoleIcon name={icon} className="size-4" aria-hidden="true" />
                        </Button>
                    ))}
                </div>
                <SettingsRow label={t('asstColorFrom')} control={<ColorField label={t('asstColorFrom')} value={draft.cover.from} onChange={(from: string) => setDraft({ ...draft, cover: { ...draft.cover, from } })} />} />
                <SettingsRow label={t('asstColorTo')} control={<ColorField label={t('asstColorTo')} value={draft.cover.to} onChange={(to: string) => setDraft({ ...draft, cover: { ...draft.cover, to } })} />} />
            </div>

            <div className="flex flex-col gap-4">
                <SegmentedControl
                    aria-label={t('tplLanguage')}
                    className="self-start"
                    value={lang}
                    onValueChange={(v) => setLang(v as Lang)}
                    options={[{ value: 'de', label: t('tplGerman') }, { value: 'en', label: t('tplEnglish') }]}
                />
                <FieldRow
                    label={t('asstName')}
                    help={enHint}
                    value={draft.name[lang]}
                    maxLength={TEMPLATE_LIMITS.name}
                    placeholder={lang === 'en' ? draft.name.de : t('asstNamePlaceholder')}
                    onChange={e => text('name', e.target.value)}
                />
                <FieldRow
                    label={t('asstDescription')}
                    help={enHint ?? t('tplDescriptionHelp')}
                    value={draft.description[lang]}
                    maxLength={TEMPLATE_LIMITS.description}
                    placeholder={lang === 'en' ? draft.description.de : t('asstRoleDescriptionPlaceholder')}
                    onChange={e => text('description', e.target.value)}
                />
                <TextareaFieldRow
                    label={t('asstPrompt')}
                    help={enHint}
                    rows={10}
                    value={draft.prompt[lang]}
                    maxLength={TEMPLATE_LIMITS.prompt}
                    placeholder={lang === 'en' ? draft.prompt.de : t('asstPromptPlaceholder')}
                    onChange={e => text('prompt', e.target.value)}
                />
            </div>

            <div className="flex flex-col">
                <SettingsRow
                    label={t('tplEnabled')}
                    description={draft.isDefault ? t('tplDefaultAlwaysOn') : t('tplEnabledHelp')}
                    control={<Switch aria-label={t('tplEnabled')} checked={draft.enabled} disabled={draft.isDefault} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />}
                />
                <SettingsRow
                    label={t('tplDefault')}
                    description={t('tplDefaultHelp')}
                    // The default changes by making another role it, never by switching it off.
                    control={<Switch aria-label={t('tplDefault')} checked={draft.isDefault} disabled={!draft.enabled || lockedDefault} onCheckedChange={(isDefault) => setDraft({ ...draft, isDefault })} />}
                />
            </div>

            {footerSlot
                ? createPortal(actions, footerSlot)
                : <div className="flex flex-col-reverse gap-2 border-t border-outline-variant pt-4 sm:flex-row sm:justify-end">{actions}</div>}
        </form>
    );
}
