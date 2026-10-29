import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { LeaveGuard } from './LeaveGuard';
import { ArrowUpRight, Check, History, House, Info, Loader2, Shield, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { Button, Notice, SettingsDialog } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { useModalContext } from '../contexts/ModalContext';
import type { KbAssignableRole, KbSettingsSection, KbSourceFlags, KnowledgeBase } from '../types';
import { KbRolesRightsTab } from './kbSettings/KbRolesRightsTab';
import { BehaviorSection } from './kbSettings/assistant/BehaviorSection';
import { StartPageSection } from './kbSettings/assistant/StartPageSection';
import { chatStartIncomplete } from './kbSettings/assistant/startPageModel';
import { VersionHistorySection } from './kbSettings/assistant/VersionHistorySection';
import { AssistantSettingsContext, useAssistantSettingsStore, type AssistantSettings } from './kbSettings/assistant/useAssistantSettings';

// Only loaded when the Mitglieder section is opened.
const KbMembersPanel = lazy(() => import('./kbSettings/KbMembersPanel').then(m => ({ default: m.KbMembersPanel })));

interface KbSettingsDialogProps {
    /** The content area the dialog covers from `sm` up (full screen below). */
    fitTo?: React.RefObject<HTMLElement | null>;
    /** Saves the drafted source flags (Rollen & Rechte); resolves false when the save failed. */
    onSave: () => Promise<boolean>;
    /** PATCH /api/kb/{id} through the app's KB store: brings the KB lists in step after a save. */
    onUpdateKb: (update: Record<string, unknown>) => Promise<boolean>;
    /** Drops the drafts and closes. Called only once a dirty close was confirmed. */
    onClose: () => void;
    /** Drafted per-KB source flags for the "Rollen & Rechte" tab. */
    flags: KbSourceFlags;
    onFlagsChange: (next: KbSourceFlags) => void;
    /** The KB being edited, for the Mitglieder section. */
    kb: KnowledgeBase;
    /** The section it opens on: the gear opens Startseite, „Teilen" Mitglieder. */
    initialSection?: KbSettingsSection;
    /** The open section, when the caller owns it (the app: `?topic=<section>`). Without it the dialog keeps its own. */
    section?: KbSettingsSection;
    onSectionChange?: (section: KbSettingsSection) => void;
    /** The flags changed: enables Speichern (so do the drafts held here). */
    dirty: boolean;
    /**
     * Opens the topic's RAG configuration. Given only to callers who may open
     * it (system admin + canOpenKbAdvancedSettings); without it Verhalten shows
     * no entry. The dialog closes first (asking about unsaved changes).
     */
    onOpenRagSettings?: () => void;
}

/** The section body while the assistant settings load or failed to. */
function AssistantGate({ store, children }: { store: AssistantSettings; children: React.ReactNode }) {
    const { t } = useTheme();
    if (store.status === 'loading') return <Loader2 className="mt-6 size-5 animate-spin text-on-surface-variant" aria-label={t('loading')} />;
    if (store.status === 'error') {
        return (
            <div className="pt-6">
                <Notice tone="warning" icon={<Info />}>
                    <span className="flex flex-wrap items-center gap-x-3">
                        {t('asstLoadFailed')}
                        <Button variant="link" size="sm" className="px-0" onClick={store.retry}>{t('asstRetry')}</Button>
                    </span>
                </Notice>
            </div>
        );
    }
    return <>{children}</>;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'invalid';

/**
 * „Thema-Einstellungen" (gear in the workspace header): the DS settings window,
 * the same one as the user settings, with five searchable sections:
 *   - Startseite: the start page as members see it, each block edited in
 *     place — the title card (title, category, description, gradient) and
 *     how a chat starts (input field with suggestions, file upload, or role
 *     cards) (StartPageSection).
 *   - Verhalten: the role the assistant answers in, its rules and a preview
 *     of the compiled prompt (BehaviorSection). Startseite and Verhalten edit
 *     ONE draft (useAssistantSettingsStore), so the cross-links between them
 *     — a role offered as a starter, a role deleted with its cards — hold
 *     before anything is saved, and they are saved as one version.
 *   - Rollen & Rechte: the KB's role × right matrix (KbRolesRightsTab).
 *   - Mitglieder: members, invites and invite links (KbMembersPanel). Role
 *     changes are drafts saved with the rest; adding and removing members,
 *     ownership and invite links apply at once (each has its own confirm or
 *     submit).
 *   - Versionsverlauf: the versions of Startseite + Verhalten, with restore
 *     (VersionHistorySection). It has no footer: nothing there is a draft.
 *
 * Modal on purpose: the rest of the app is inert while it is open, so the
 * sidebars cannot switch the chat or open a source behind the settings.
 * Full screen on phones; from `sm` it covers the chat's content area (DS
 * `size="xl"` + `fitTo`), so switching sections does not resize it.
 *
 * Unlike the user settings these are saved explicitly, so it carries a
 * footer for every section: Speichern saves what changed and keeps the dialog
 * open on the same section, with the outcome in the status on the left
 * ("Keine Änderungen", "Ungespeicherte Änderungen", "Speichern…",
 * "Gespeichert", or the error). Löschen (the behavior: no role, no rule) only
 * shows on Verhalten. Only X, Escape, a click on the
 * overlay and Abbrechen close it, and with unsaved changes they ask first.
 */
export function KbSettingsDialog({
    fitTo, kb, initialSection = 'start', section: ownedSection, onSectionChange, onSave, onUpdateKb, onClose, flags, onFlagsChange, dirty, onOpenRagSettings,
}: KbSettingsDialogProps) {
    const { t } = useTheme();
    const { showConfirm } = useModalContext();
    const [localSection, setLocalSection] = useState<KbSettingsSection>(initialSection);
    const section = ownedSection ?? localSection;
    const setSection = onSectionChange ?? setLocalSection;
    const [status, setStatus] = useState<SaveStatus>('idle');
    const saving = status === 'saving';

    // Startseite + Verhalten: one draft, loaded when the dialog opens.
    const openSection = useCallback((s: KbSettingsSection) => setSection(s), [setSection]);
    const assistant = useAssistantSettingsStore({ kb, onUpdateKb, onOpenSection: openSection });
    // While a role is created or edited, Verhalten owns the footer (through the slot).
    const [roleEditorOpen, setRoleEditorOpen] = useState(false);

    // Member role changes (Mitglieder) are drafts too, held here because the
    // panel lives only while its section is shown. Adding and removing members
    // stay immediate — each has its own confirm or submit.
    const [roleDrafts, setRoleDrafts] = useState<Record<string, KbAssignableRole>>({});
    // Mitglieder's list ↔ „Mitglieder hinzufügen". While adding, that view owns
    // the footer (its own Abbrechen/Hinzufügen or Fertig, through the slot) and
    // the window's Abbrechen/Speichern step aside: one row of actions per
    // screen. Leaving the section returns to the list.
    const [membersView, setMembersView] = useState<'members' | 'add'>('members');
    const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);
    const addingMembers = section === 'members' && membersView === 'add';
    const editingRole = section === 'behavior' && roleEditorOpen;
    const [membersRevision, setMembersRevision] = useState(0);
    const setRoleDraft = (userId: string, role: KbAssignableRole | null) => setRoleDrafts(prev => {
        const next = { ...prev };
        if (role) next[userId] = role; else delete next[userId];
        return next;
    });
    const anyDirty = dirty || assistant.dirty || Object.keys(roleDrafts).length > 0;
    // A title is required, and the chat start must be fully set up.
    // Speichern stays enabled: a click on an incomplete state shows what is missing instead of saving.
    const invalid = !!assistant.draft && (!assistant.draft.title.trim() || chatStartIncomplete(assistant.draft.startPage, assistant.draft.behavior.activeRoleId));
    const trySave = () => {
        if (invalid) {
            assistant.revealErrors();
            setSection('start');
            setStatus('invalid');
            return;
        }
        void run(save);
    };

    // One PUT per changed member. A failed one keeps its draft, so the select
    // still shows it and Speichern can retry; the list is read again either way.
    // Only the drafts that were saved — and still hold the value that was
    // saved — are dropped: a role changed while the requests were in flight
    // stays a draft instead of being overwritten by the earlier snapshot.
    const saveRoleDrafts = async () => {
        const entries = Object.entries(roleDrafts);
        if (entries.length === 0) return true;
        const results = await Promise.allSettled(entries.map(([userId, role]) =>
            axios.put(`${API_BASE_URL}/api/kb/${kb.id}/members/${userId}`, { role })));
        setRoleDrafts(prev => {
            const next = { ...prev };
            entries.forEach(([userId, role], i) => {
                if (results[i].status === 'fulfilled' && next[userId] === role) delete next[userId];
            });
            return next;
        });
        setMembersRevision(r => r + 1);
        return results.every(r => r.status === 'fulfilled');
    };

    const run = async (action: () => Promise<boolean>) => {
        setStatus('saving');
        setStatus(await action() ? 'saved' : 'error');
    };
    const save = async () => {
        const kbSaved = dirty ? await onSave() : true;
        const assistantSaved = assistant.dirty ? await assistant.save() : true;
        const rolesSaved = await saveRoleDrafts();
        return kbSaved && assistantSaved && rolesSaved;
    };

    const confirmDiscard = () => showConfirm(t('kbSettingsDiscardMessage'), t('kbSettingsDiscardTitle'), {
        tone: 'destructive', confirmLabel: t('kbSettingsDiscardConfirm'),
    });
    // Set once a close is confirmed, so the navigation that close makes (the
    // dialog lives in `?topic=`) is not asked about a second time.
    const leaving = useRef(false);
    // New unsaved changes after a confirmed close that did not unmount the
    // dialog re-arm the guard.
    useEffect(() => { if (anyDirty) leaving.current = false; }, [anyDirty]);
    const requestClose = async (): Promise<boolean> => {
        if (saving) return false;
        if (anyDirty && !await confirmDiscard()) return false;
        leaving.current = true;
        onClose();
        return true;
    };

    // "Gespeichert" holds only until the next edit; an error stays until the
    // next attempt, so it is still readable after the user starts fixing it.
    let statusText: string | null = null;
    if (status === 'saving') statusText = t('saving');
    else if (status === 'error') statusText = assistant.saveError === 'conflict' ? t('asstConflict') : t('settingsUpdateError');
    else if (status === 'invalid') statusText = t('asstSaveIncomplete');
    else if (!anyDirty) statusText = status === 'saved' ? t('kbSettingsSaved') : t('kbSettingsNoChanges');

    const failed = status === 'error' || status === 'invalid';
    const unsaved = anyDirty && status !== 'saving' && !failed;

    return (
        <AssistantSettingsContext.Provider value={assistant}>
            <LeaveGuard when={anyDirty} allow={leaving} confirm={confirmDiscard} />
            <SettingsDialog
                open
                onOpenChange={(open) => { if (!open) void requestClose(); }}
                value={section}
                onValueChange={(v) => {
                    setSection(v as KbSettingsSection);
                    if (v !== 'members') setMembersView('members');
                }}
                size="xl"
                fitTo={fitTo}
                title={t('kbSettingsTitle')}
                closeLabel={t('close')}
                searchPlaceholder={t('settingsSearch')}
                emptyLabel={t('settingsNoMatch')}
                sections={[
                    {
                        value: 'start',
                        label: t('asstStartPage'),
                        icon: <House aria-hidden="true" />,
                        keywords: [t('asstTitle'), t('asstCategory'), t('asstDescription'), t('asstQuestions'), t('asstRoleEntries'), t('asstChatStart')],
                        content: <AssistantGate store={assistant}><StartPageSection /></AssistantGate>,
                    },
                    {
                        value: 'behavior',
                        label: t('kbSettingsTabBehavior'),
                        icon: <SlidersHorizontal aria-hidden="true" />,
                        keywords: [t('asstTabRole'), t('asstTabRules'), t('asstRagInstructions'), t('kbSettingsKeywordsBehavior')],
                        content: (
                            <>
                                <AssistantGate store={assistant}>
                                    <BehaviorSection footerSlot={editingRole ? footerSlot : null} onSubViewChange={setRoleEditorOpen} />
                                </AssistantGate>
                                {/* The RAG configuration lives under Verhalten (it changes how
                                    the topic answers), for the few who may open it; it leaves
                                    the dialog, hence the ↗. It does not depend on the role
                                    settings loading. */}
                                {onOpenRagSettings && !editingRole && (
                                    <div className="mt-6 flex justify-end">
                                        <Button variant="outline" onClick={() => { void requestClose().then(closed => { if (closed) onOpenRagSettings(); }); }}>
                                            {t('kbAdvancedSettings')}
                                            <ArrowUpRight size={16} aria-hidden="true" />
                                        </Button>
                                    </div>
                                )}
                            </>
                        ),
                    },
                    {
                        value: 'roles',
                        label: t('kbSettingsTabRoles'),
                        icon: <Shield aria-hidden="true" />,
                        keywords: [t('kbSettingsKeywordsRoles')],
                        content: (
                            <div className="pt-6">
                                <KbRolesRightsTab flags={flags} onFlagsChange={onFlagsChange} onAssignPeople={() => setSection('members')} />
                            </div>
                        ),
                    },
                    {
                        value: 'members',
                        label: t('members'),
                        icon: <Users aria-hidden="true" />,
                        keywords: [t('addMembers'), t('inviteLinks'), t('kbSettingsKeywordsMembers')],
                        content: (
                            <div className="flex flex-col gap-4 pt-6">
                                <Suspense fallback={<Loader2 className="size-5 animate-spin text-on-surface-variant" aria-hidden="true" />}>
                                    <KbMembersPanel
                                        kb={kb}
                                        myRole={kb.myRole ?? 'view'}
                                        roleDrafts={roleDrafts}
                                        onRoleDraftChange={setRoleDraft}
                                        revision={membersRevision}
                                        view={membersView}
                                        onViewChange={setMembersView}
                                        footerSlot={footerSlot}
                                    />
                                </Suspense>
                            </div>
                        ),
                    },
                    {
                        value: 'versions',
                        label: t('asstVersions'),
                        icon: <History aria-hidden="true" />,
                        keywords: [t('asstRestore'), t('asstAllChanges')],
                        content: <AssistantGate store={assistant}><VersionHistorySection /></AssistantGate>,
                    },
                ]}
                // Versionsverlauf has no footer: nothing there is a draft.
                footer={section === 'versions' ? undefined : addingMembers || editingRole ? (
                    <div ref={setFooterSlot} className={editingRole ? 'flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between' : 'ml-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'} />
                ) : (
                    <>
                        <div className="flex items-center gap-3">
                            {section === 'behavior' && (
                                <Button variant="ghost-destructive" onClick={() => void run(assistant.resetBehavior)} disabled={saving || assistant.status !== 'ready'}>
                                    <Trash2 size={16} aria-hidden="true" />
                                    {t('delete')}
                                </Button>
                            )}
                            <span
                                className={`flex items-center gap-2 text-sm ${failed ? 'text-error' : unsaved ? 'text-on-surface' : 'text-on-surface-variant'}`}
                                role={failed ? 'alert' : 'status'}
                                aria-live="polite"
                            >
                                {unsaved && <span aria-hidden="true" className="size-2 rounded-full bg-warning" />}
                                {unsaved ? t('asstUnsaved') : statusText}
                                {status === 'error' && assistant.saveError === 'conflict' && (
                                    <Button variant="link" size="sm" className="px-0" onClick={() => { setStatus('idle'); assistant.retry(); }}>{t('asstReload')}</Button>
                                )}
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => void requestClose()} disabled={saving}>{t('cancel')}</Button>
                            <Button onClick={trySave} disabled={!anyDirty || saving}>
                                {saving
                                    ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                    : <Check size={16} aria-hidden="true" />}
                                {t('save')}
                            </Button>
                        </div>
                    </>
                )}
            />
        </AssistantSettingsContext.Provider>
    );
}
