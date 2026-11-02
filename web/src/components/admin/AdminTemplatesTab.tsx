import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { ArrowDown, ArrowUp, Ban, Pencil, Plus, Save, Star, Trash2, Undo2 } from 'lucide-react';
import {
    Badge, BreadcrumbBack, Button, ColorField, Notice, SettingsRow, Switch, Tabs, TabsContent, TabsList, TabsTrigger, cardAccentStyle,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useModalContext } from '../../contexts/ModalContext';
import { RoleStartEditor } from '../kbSettings/assistant/ChatStartEditor';
import { KindIcon } from '../kbSettings/assistant/entryKinds';
import { RoleNameFields, RolePromptField } from '../kbSettings/assistant/RoleFields';
import { RolePanelFrame } from '../kbSettings/assistant/RolePreviewPanel';
import { IconTile } from '../kbSettings/assistant/roles';
import AdminCategoriesSection from './AdminCategoriesSection';
import { AdminListCard } from './AdminListCard';
import {
    TEMPLATE_LIMITS, canSaveTemplate, createTemplate, deleteTemplate, emptyTemplate, inputOf, listTemplates, reorderTemplates,
    startIn, textIn, updateTemplate, withStart, type Lang, type RoleTemplate, type TemplateInput,
} from './roleTemplatesApi';

/** The server's reason for a refused write (a 400's `error`), else the generic line. */
function reason(err: unknown, fallback: string): string {
    if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: string } | undefined)?.error;
        if (msg) return msg;
    }
    return fallback;
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

    // Admins write and read the templates in their own language (the other is translated).
    const lang: Lang = language === 'en' ? 'en' : 'de';
    const name = (r: RoleTemplate) => textIn(r.name, lang);

    if (editing) {
        return (
            <TemplateEditor
                draft={editing.draft}
                lang={lang}
                isNew={editing.id === null}
                lockedDefault={editing.id !== null && !!templates?.find(r => r.id === editing.id)?.isDefault}
                setDraft={(draft) => setEditing({ ...editing, draft })}
                onBack={() => setEditing(null)}
                onSave={async (draft) => {
                    const ok = await run(
                        () => (editing.id === null ? createTemplate(draft) : updateTemplate(editing.id, draft)),
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
                            {/* The role card's avatar: its colour, how its chat starts. */}
                            <span style={cardAccentStyle(r.cover.from)}>
                                <IconTile glyph={<KindIcon kind={r.start?.kind ?? 'input'} />} tone="accent" size="sm" />
                            </span>
                            {name(r)}
                        </span>
                    )}
                    badge={r.isDefault
                        ? <Badge tone="primary">{t('tplDefault')}</Badge>
                        : !r.enabled ? <Badge tone="neutral">{t('tplDisabled')}</Badge> : undefined}
                    details={[
                        textIn(r.description, lang) || t('tplNoDescription'),
                        r.usedBy === 1 ? t('tplUsedByOne') : t('tplUsedBy').replace('{n}', String(r.usedBy)),
                    ]}
                    actionsLabel={t('tplActionsFor').replace('{name}', name(r))}
                    actions={[
                        { label: t('edit'), icon: <Pencil className="size-4" />, onSelect: () => setEditing({ id: r.id, draft: writtenIn(inputOf(r), lang) }) },
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

/**
 * The draft as the admin edits it in lang: every text lang leaves empty takes
 * the one shown in its place (the German), so the save — which translates
 * lang's texts into the other language — never empties a text the admin did
 * not touch.
 */
function writtenIn(d: TemplateInput, lang: Lang): TemplateInput {
    if (lang === 'de') return { ...d, lang };
    const fill = (x: { de: string; en: string }) => ({ ...x, en: textIn(x, 'en') });
    const start = d.start && {
        ...d.start, text: fill(d.start.text), instruction: fill(d.start.instruction),
        suggestions: { ...d.start.suggestions, fixedQuestions: { ...d.start.suggestions.fixedQuestions, en: startIn(d.start, 'en').suggestions.fixedQuestions } },
    };
    return { ...d, lang, name: fill(d.name), description: fill(d.description), prompt: fill(d.prompt), start };
}

/**
 * A template's edit screen: the topic's role editor's layout (RolePanelFrame,
 * the same name, description and prompt fields, the same start editor),
 * without what belongs to a topic — its rules, the AI writing help. Its
 * colour is the card's; the avatar shows how its chat starts.
 *
 * The admin writes in their own language; the server translates the texts
 * into the other one after the save (a topic compiles German, members see
 * the role in their language).
 */
function TemplateEditor({
    draft, lang, isNew, lockedDefault, setDraft, onBack, onSave, footerSlot,
}: {
    draft: TemplateInput;
    lang: Lang;
    isNew: boolean;
    /** The default being edited: it stays the default until another role takes it. */
    lockedDefault: boolean;
    setDraft: (d: TemplateInput) => void;
    onBack: () => void;
    onSave: (draft: TemplateInput) => Promise<void>;
    footerSlot: HTMLElement | null;
}) {
    const { t } = useTheme();
    const formId = useId();
    const [busy, setBusy] = useState(false);
    const text = (field: 'name' | 'description' | 'prompt', value: string) =>
        setDraft({ ...draft, lang, [field]: { ...draft[field], [lang]: value } });
    const start = startIn(draft.start, lang);

    const actions = (
        <>
            <Button type="button" variant="outline" onClick={onBack}>{t('cancel')}</Button>
            <Button type="submit" form={formId} disabled={busy || !canSaveTemplate(draft, lang)}>
                <Save size={18} aria-hidden="true" /> {t('save')}
            </Button>
        </>
    );
    const color = draft.cover.from;

    return (
        <form
            id={formId}
            className="flex flex-col gap-6"
            onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                    await onSave({ ...draft, lang });
                } finally {
                    setBusy(false);
                }
            }}
        >
            <div className="flex min-w-0 flex-col gap-1.5">
                <BreadcrumbBack trail={[t('adminTabTemplates'), t('tplTabRoles')]} labels={{ nav: t('breadcrumbNav'), back: t('backTo') }} onClick={onBack} />
                <h3 className="m-0 text-lg font-semibold text-on-surface">{isNew ? t('tplNew') : t('tplEdit')}</h3>
                <p className="m-0 text-sm text-on-surface-variant">{t('tplAutoTranslate')}</p>
            </div>

            <RolePanelFrame
                label={isNew ? t('tplNew') : t('tplEdit')}
                role={{ cover: { from: color, to: color } }}
                start={start}
                left={(
                    <div className="flex flex-col gap-4 px-6">
                        <RoleNameFields
                            name={draft.name[lang]}
                            description={draft.description[lang]}
                            onName={(v) => text('name', v)}
                            onDescription={(v) => text('description', v)}
                            nameMax={TEMPLATE_LIMITS.name}
                            descriptionMax={TEMPLATE_LIMITS.description}
                        />
                        <div className="flex flex-col">
                            <SettingsRow
                                label={t('tplColor')}
                                description={t('tplColorHelp')}
                                control={<ColorField label={t('tplColor')} value={color} onChange={(c: string) => setDraft({ ...draft, cover: { from: c, to: c } })} labels={{ custom: t('colorFieldCustom'), presets: t('colorFieldPresets') }} />}
                            />
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
                    </div>
                )}
                stage={(
                    // How a chat in the role starts — the topic role editor's start, here for every topic without its own.
                    <div className="flex flex-col gap-4 px-6 py-5">
                        <div className="flex flex-col">
                            <span className="text-base font-semibold text-on-surface">{t('tplStartTitle')}</span>
                            <span className="text-sm text-on-surface-variant">{t('tplStartSub')}</span>
                        </div>
                        <RoleStartEditor
                            start={start}
                            onChange={(fn) => setDraft({ ...draft, lang, start: withStart(draft.start, lang, fn(start)) })}
                            roleName={draft.name[lang].trim() || t('asstAssistant')}
                        />
                    </div>
                )}
                right={(
                    <div className="flex min-w-0 flex-[999_1_32.5rem] flex-col gap-3.5 bg-surface-container-low p-6">
                        <div className="min-w-0">
                            <h4 className="m-0 text-[15px] font-semibold text-on-surface">{t('asstRolePromptLayer')}</h4>
                            <p className="m-0 mt-0.5 text-sm text-on-surface-variant">{t('tplPromptHint')}</p>
                        </div>
                        <RolePromptField
                            value={draft.prompt[lang]}
                            max={TEMPLATE_LIMITS.prompt}
                            onChange={(v) => text('prompt', v)}
                        />
                    </div>
                )}
            />

            {footerSlot
                ? createPortal(actions, footerSlot)
                : <div className="flex flex-col-reverse gap-2 border-t border-outline-variant pt-4 sm:flex-row sm:justify-end">{actions}</div>}
        </form>
    );
}
