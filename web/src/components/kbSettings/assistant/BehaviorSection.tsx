import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Check, Copy, MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
import {
    Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
    FilterChips, PanelSection, SelectableCardGroup, type ActionMenuItem,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from '../../../api';
import { useTheme } from '../../../contexts/ThemeContext';
import { ROLE_ENTRY_MAX, defaultStart, type CustomRole, type EntryStart } from './api';
import { RoleEditorView } from './RoleEditorView';
import { canSaveEditor, editTarget, editorFields, idleAi, type RoleEditor } from './roleEditor';
import { RolePreviewPanel } from './RolePreviewPanel';
import { NewRoleTile, RoleTile } from './RoleTiles';
import { allRoles, defaultRules, newId, readPref, rulesFor, writePref, type RoleView } from './roleModel';
import { startEntries } from './startPageModel';
import { useAssistantSettings } from './useAssistantSettings';
import { useStarterSample } from './useStarterSample';

const PANEL_PREF = 'kbSettings.behavior.promptPreview';

/**
 * „Verhalten": the role the assistant answers in (templates from the central
 * catalog, the KB's own roles) as cards; under them the viewed role — how a
 * chat in it begins and its system prompt in the order the server compiles
 * it (role → „Regeln:" → fixed RAG instructions), with the topic's rules
 * switched right there. Edits go to the dialog's shared draft; the dialog's
 * Speichern writes them. While a role is created or edited the sub-view owns
 * the footer (rendered into `footerSlot`).
 */
export function BehaviorSection({
    footerSlot, onSubViewChange, onEditorDirtyChange,
}: {
    footerSlot: HTMLElement | null;
    onSubViewChange: (open: boolean) => void;
    /** The role editor holds changes not yet applied to the draft (they would be lost on close). */
    onEditorDirtyChange?: (dirty: boolean) => void;
}) {
    const { t, language } = useTheme();
    const store = useAssistantSettings();
    const { catalog, draft, kb } = store;
    const behavior = draft?.behavior;
    const page = draft?.startPage;
    // The start page's further cards, each with its role's start.
    const entries = useMemo(() => (page && behavior ? startEntries(page, behavior.activeRoleId).slice(1) : []), [page, behavior]);
    const allOfThem = useMemo(() => allRoles(catalog, behavior), [catalog, behavior]);
    const entriesFor = (id: string) => entries.filter(e => e.roleId === id);
    // A template switched off in „Vorlagen" shows only while this KB uses it.
    const roles = allOfThem.filter(r => !r.disabled || r.id === behavior?.activeRoleId || entriesFor(r.id).length > 0);
    const templates = roles.filter(r => !r.custom);
    const own = roles.filter(r => r.custom);
    const active = roles.find(r => r.id === behavior?.activeRoleId) ?? roles[0];

    const [filter, setFilter] = useState('all');
    const [editor, setEditorState] = useState<RoleEditor | null>(null);
    const setEditor = (e: RoleEditor | null) => {
        setEditorState(e);
        onSubViewChange(e !== null);
    };
    // What the editor opened with: its fields differing from these are
    // changes the dialog's close guard has to ask about.
    const [editorBase, setEditorBase] = useState<string | null>(null);
    const openEditor = (e: RoleEditor) => {
        setEditorBase(editorFields(e));
        setEditor(e);
    };
    const editorDirty = !!editor && editorFields(editor) !== editorBase;
    useEffect(() => { onEditorDirtyChange?.(editorDirty); }, [editorDirty, onEditorDirtyChange]);
    useEffect(() => () => onEditorDirtyChange?.(false), [onEditorDirtyChange]);
    // „Rolle ansehen" from the Startseite opens this section on that role's preview.
    const [openedOn] = useState(() => (store.pending?.type === 'previewRole' ? store.pending.roleId : null));
    // The preview under the cards: closed with its ×, opened again by a card.
    const [panelOpen, setPanelOpenState] = useState(() => (openedOn ? true : readPref(PANEL_PREF, true)));
    const setPanelOpen = (v: boolean) => {
        setPanelOpenState(v);
        writePref(PANEL_PREF, v);
    };
    const [previewId, setPreviewId] = useState<string | null>(openedOn);
    const [deleteAsk, setDeleteAsk] = useState<RoleView | null>(null);
    const panelRef = useRef<HTMLElement>(null);

    // The fixed RAG instructions, in the language the KB's prompt is compiled in.
    const [ragPrompt, setRagPrompt] = useState<string | null>(null);
    const ragLang = catalog?.language ?? 'de';
    useEffect(() => {
        let cancelled = false;
        axios.get<{ prompt: string }>(`${API_BASE_URL}/api/chat/rag-system-prompt`, { params: { lang: ragLang } })
            .then(res => { if (!cancelled) setRagPrompt(res.data.prompt); })
            .catch(() => { if (!cancelled) setRagPrompt(''); });
        return () => { cancelled = true; };
    }, [ragLang]);

    // An example of the dynamic suggestions, generated for the role edited or
    // previewed (as saved; a new role's are the active role's).
    const sampleRoleId = editor ? (editor.kind === 'template' ? editor.roleId : editTarget(editor)?.roleId) : previewId ?? undefined;
    const { sample: dynamicSample, loading: sampleLoading, newExample } = useStarterSample(kb.id, language, sampleRoleId);

    const { pending, clearPending } = store;
    useEffect(() => {
        if (pending?.type !== 'previewRole') return;
        clearPending();
        onSubViewChange(false);
        writePref(PANEL_PREF, true);
        requestAnimationFrame(() => panelRef.current?.scrollIntoView?.({ block: 'nearest' }));
    }, [pending, clearPending, onSubViewChange]);

    if (!catalog || !behavior || !active) return null;
    const limits = catalog.limits;

    const previewed = roles.find(r => r.id === (previewId ?? behavior.activeRoleId)) ?? active;
    const isActive = (id: string) => id === behavior.activeRoleId;
    const showPreview = (id: string) => {
        setPreviewId(id);
        if (!panelOpen) setPanelOpen(true);
    };
    // How a role starts on the start page (set here; picked in „Rollenauswahl"):
    // every role starts with the input field until another start is set.
    const roleStart = (id: string): EntryStart | undefined => page?.roleStarts[id];
    const setRoleStart = (id: string, fn: ((e: EntryStart) => EntryStart) | null) => store.updateStartPage(p => {
        if (fn) return { ...p, roleStarts: { ...p.roleStarts, [id]: fn(p.roleStarts[id] ?? defaultStart()) } };
        // Back to the default: the input field.
        const roleStarts = { ...p.roleStarts };
        delete roleStarts[id];
        return { ...p, roleStarts };
    });
    const activateRole = (id: string) => {
        const previous = behavior.activeRoleId;
        store.updateBehavior(b => ({ ...b, activeRoleId: id }));
        // Every role shows once on the start page: the active role first, so a
        // card of the new one passes to the role it replaces.
        store.updateStartPage(p => ({ ...p, roleEntries: p.roleEntries.map(e => (e.roleId === id ? { ...e, roleId: previous } : e)) }));
        setPreviewId(null);
    };
    // The edit screen works on a copy of the role's texts, rules and start.
    const rulesOf = (id: string) => structuredClone(rulesFor(catalog, behavior, id));
    const fieldsOf = (r: RoleView) => ({ description: r.description, prompt: r.prompt, rules: rulesOf(r.id), start: roleStart(r.id), ai: idleAi });
    const newRole = (): RoleEditor => ({ kind: 'new', name: '', description: '', prompt: '', rules: defaultRules(catalog), ai: idleAi });
    const copyOf = (r: RoleView, suffix = 'asstCopySuffixAdjusted'): RoleEditor => ({ kind: 'new', copyOf: r.name, ...fieldsOf(r), name: `${r.name} ${t(suffix)}` });
    const editOf = (r: RoleView): RoleEditor => (r.custom
        ? { kind: 'edit', editing: { roleId: r.id, legacy: r.legacy }, name: r.name, ...fieldsOf(r) }
        : { kind: 'template', roleId: r.id, name: r.name, ...fieldsOf(r) });
    const editedRole = editor ? roles.find(r => r.id === (editor.kind === 'template' ? editor.roleId : editTarget(editor)?.roleId)) : undefined;
    const offerAsEntry = (r: RoleView) => store.send('start', { type: 'addEntry', roleId: r.id });
    const canOffer = (r: RoleView) => entries.length < ROLE_ENTRY_MAX && !isActive(r.id) && entriesFor(r.id).length === 0;
    const askDelete = (r: RoleView) => {
        if (entriesFor(r.id).length) setDeleteAsk(r);
        else {
            store.deleteRole(r.id);
            if (previewId === r.id) setPreviewId(null);
        }
    };

    const roleActions = (r: RoleView): ActionMenuItem[] => [
        // „Diese Rolle verwenden" lives here (and in the card's split button), not in the preview.
        { label: isActive(r.id) ? t('asstInUse') : t('asstUseThisRole'), icon: <Check className="size-4" />, disabled: isActive(r.id), onSelect: () => activateRole(r.id) },
        ...(r.custom
            ? [
                { label: t('asstEdit'), icon: <Pencil className="size-4" />, separatorBefore: true, onSelect: () => openEditor(editOf(r)) },
                { label: t('asstDuplicate'), icon: <Copy className="size-4" />, onSelect: () => openEditor(copyOf(r, 'asstCopySuffix')) },
                { label: t('asstOfferAsEntry'), icon: <MessageSquarePlus className="size-4" />, disabled: !canOffer(r), onSelect: () => offerAsEntry(r) },
                { label: t('delete'), icon: <Trash2 className="size-4" />, destructive: true, separatorBefore: true, onSelect: () => askDelete(r) },
            ]
            : [
                // A template's prompt and rules are fixed: „Bearbeiten" sets up its start, the copy changes the rest.
                { label: t('asstEdit'), icon: <Pencil className="size-4" />, separatorBefore: true, onSelect: () => openEditor(editOf(r)) },
                { label: t('asstCopyTemplate'), icon: <Copy className="size-4" />, onSelect: () => openEditor(copyOf(r)) },
                { label: t('asstOfferAsEntry'), icon: <MessageSquarePlus className="size-4" />, disabled: !canOffer(r), onSelect: () => offerAsEntry(r) },
            ]),
    ];

    const saveEditor = (e: RoleEditor) => {
        const roleId = e.kind === 'template' ? e.roleId : e.kind === 'edit' ? e.editing.roleId : newId('c');
        if (e.kind === 'edit') {
            store.updateBehavior(b => ({
                ...b,
                // The legacy role may go without a name: it keeps the one it has.
                customRoles: b.customRoles.map(r => (r.id === roleId
                    ? { ...r, name: e.name.trim() || r.name, description: e.description.trim(), prompt: e.prompt }
                    : r)),
            }));
        } else if (e.kind === 'new') {
            const role: CustomRole = {
                id: roleId,
                name: e.name.trim(),
                prompt: e.prompt,
                description: e.description.trim() || (e.copyOf ? t('asstDescCopy').replace('{name}', e.copyOf) : t('asstDescWritten')),
                icon: e.copyOf ? 'copy' : 'user-round',
            };
            // Saved with the KB's roles, but NOT active: „Diese Rolle verwenden" takes it over.
            store.updateBehavior(b => ({ ...b, customRoles: [...b.customRoles, role] }));
            setPreviewId(roleId);
            if (!panelOpen) setPanelOpen(true);
        }
        // An own role's rules are its own; a template's are the system preset.
        if (e.kind !== 'template') store.updateBehavior(b => ({ ...b, roleRules: { ...b.roleRules, [roleId]: e.rules } }));
        setRoleStart(roleId, e.start ? () => e.start as EntryStart : null);
        setEditor(null);
    };

    const filtered = filter === 'presets' ? templates : filter === 'custom' ? own : roles;
    const deleteEntries = deleteAsk ? entriesFor(deleteAsk.id).length : 0;

    if (editor) {
        return (
            <>
                <RoleEditorView
                    kbId={kb.id}
                    editor={editor}
                    setEditor={setEditor}
                    onBack={() => setEditor(null)}
                    onCopyTemplate={editor.kind === 'template' && editedRole ? () => openEditor(copyOf(editedRole)) : undefined}
                    maxPrompt={limits.promptMax}
                    cover={editedRole ?? {}}
                    onStartPage={!!editedRole && entriesFor(editedRole.id).length > 0}
                    ragPrompt={ragPrompt}
                    dynamicSample={dynamicSample}
                    sampleLoading={sampleLoading}
                    onNewExample={newExample}
                />
                {footerSlot && createPortal(
                    <>
                        <span className="text-sm text-on-surface-variant">
                            {editor.kind === 'new' ? t('asstEditorSavedWithRoles') : t('asstEditorChangesTo').replace('{name}', editor.name)}
                        </span>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setEditor(null)}>{t('cancel')}</Button>
                            <Button disabled={!canSaveEditor(editor)} onClick={() => saveEditor(editor)}>
                                <Check className="size-4" aria-hidden="true" />
                                {editor.kind === 'new' ? t('asstSaveRole') : t('asstApplyChanges')}
                            </Button>
                        </div>
                    </>,
                    footerSlot,
                )}
            </>
        );
    }

    return (
        <>
            <div className="flex flex-col gap-6 pt-6">
                    <PanelSection title={t('asstTabRole')} hint={t('asstRoleHint')}>
                        <div className="mt-2 flex flex-col gap-4">
                            <FilterChips
                                aria-label={t('asstFilterRoles')}
                                value={filter}
                                onValueChange={setFilter}
                                options={[
                                    { value: 'all', label: `${t('asstFilterAll')} (${roles.length})` },
                                    { value: 'presets', label: `${t('asstFilterTemplates')} (${templates.length})` },
                                    { value: 'custom', label: `${t('asstFilterOwn')} (${own.length})` },
                                ]}
                            />
                            {/* One choice: the role the preview shows (none while the panel is closed). Room for its ring. */}
                            <SelectableCardGroup
                                aria-label={t('asstRoles')}
                                value={panelOpen ? previewed.id : ''}
                                onValueChange={showPreview}
                                className="grid-cols-[repeat(auto-fill,11.5rem)] p-1"
                            >
                                {filtered.map(r => (
                                    <RoleTile
                                        key={r.id}
                                        role={r}
                                        start={roleStart(r.id)}
                                        onStartPage={entriesFor(r.id).length > 0}
                                        active={isActive(r.id)}
                                        onUse={() => activateRole(r.id)}
                                        actions={roleActions(r)}
                                        actionsLabel={t('asstActionsFor').replace('{name}', r.name)}
                                    />
                                ))}
                                {filter !== 'presets' && own.length < limits.customRolesMax && (
                                    <NewRoleTile onClick={() => openEditor(newRole())} />
                                )}
                            </SelectableCardGroup>
                            {panelOpen && (
                                <RolePreviewPanel
                                    key={previewed.id}
                                    ref={panelRef}
                                    role={previewed}
                                    active={isActive(previewed.id)}
                                    onStartPage={entriesFor(previewed.id).length > 0}
                                    start={roleStart(previewed.id)}
                                    rules={rulesFor(catalog, behavior, previewed.id)}
                                    ragPrompt={ragPrompt}
                                    dynamicSample={dynamicSample}
                                    onClose={() => { setPanelOpen(false); setPreviewId(null); }}
                                />
                            )}
                        </div>
                    </PanelSection>
            </div>

            <Dialog open={!!deleteAsk} onOpenChange={(o) => { if (!o) setDeleteAsk(null); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader className="pr-8">
                        <DialogTitle className="text-lg">{t('asstDeleteRoleTitle').replace('{name}', deleteAsk?.name ?? '')}</DialogTitle>
                        <DialogDescription>
                            {(deleteEntries === 1 ? t('asstDeleteRoleTextOne') : t('asstDeleteRoleTextN').replace('{n}', String(deleteEntries)))}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setDeleteAsk(null)}>{t('cancel')}</Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (!deleteAsk) return;
                                store.deleteRole(deleteAsk.id);
                                if (previewId === deleteAsk.id) setPreviewId(null);
                                setDeleteAsk(null);
                            }}
                        >
                            <Trash2 className="size-4" aria-hidden="true" /> {t('asstDeleteRoleConfirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
