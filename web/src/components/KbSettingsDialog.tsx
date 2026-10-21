import { lazy, Suspense, useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { Check, Loader2, Shield, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { Button, PanelSection, SettingsDialog, Textarea } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { useModalContext } from '../contexts/ModalContext';
import type { KbAssignableRole, KbSettingsSection, KbSourceFlags, KnowledgeBase } from '../types';
import { KbRolesRightsTab } from './kbSettings/KbRolesRightsTab';

// Only loaded when the Mitglieder section is opened.
const KbMembersPanel = lazy(() => import('./kbSettings/KbMembersPanel').then(m => ({ default: m.KbMembersPanel })));

const MAX_LEN = 8000;

interface KbSettingsDialogProps {
    /** The content area the dialog covers from `sm` up (full screen below). */
    fitTo?: React.RefObject<HTMLElement | null>;
    draft: string;
    onDraftChange: (value: string) => void;
    /** Saves what changed on either tab; resolves false when the save failed. */
    onSave: () => Promise<boolean>;
    /** Deletes the stored system prompt; resolves false when that failed. */
    onDelete: () => Promise<boolean>;
    /** Drops the drafts and closes. Called only once a dirty close was confirmed. */
    onClose: () => void;
    /** Drafted per-KB source flags for the "Rollen & Rechte" tab. */
    flags: KbSourceFlags;
    onFlagsChange: (next: KbSourceFlags) => void;
    /** The KB being edited, for the Mitglieder section. */
    kb: KnowledgeBase;
    /** The section it opens on: the gear opens Verhalten, „Teilen" Mitglieder. */
    initialSection?: KbSettingsSection;
    /** The prompt draft or the flags changed: enables Speichern (so do role drafts, held here). */
    dirty: boolean;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * „Thema-Einstellungen" (gear in the workspace header): the DS settings window,
 * the same one as the user settings, with three searchable sections:
 *   - Verhalten: the KB's own system prompt, plus the fixed RAG instructions
 *     it is combined with (read-only).
 *   - Rollen & Rechte: the KB's role × right matrix (KbRolesRightsTab).
 *   - Mitglieder: members, invites and invite links (KbMembersPanel). Role
 *     changes are drafts saved with the rest; adding and removing members,
 *     ownership and invite links apply at once (each has its own confirm or
 *     submit).
 *
 * Modal on purpose: the rest of the app is inert while it is open, so the
 * sidebars cannot switch the chat or open a source behind the settings.
 * Full screen on phones; from `sm` it covers the chat's content area (DS
 * `size="xl"` + `fitTo`), so switching sections does not resize it.
 *
 * Unlike the user settings these are saved explicitly, so it carries a
 * footer for every section: Speichern saves what changed and keeps the dialog
 * open on the same section, with the outcome in the status on the left
 * ("Keine Änderungen", "Speichern…", "Gespeichert", or the error). Löschen
 * (the system prompt) only shows on Verhalten. Only X, Escape, a click on the
 * overlay and Abbrechen close it, and with unsaved changes they ask first.
 */
export function KbSettingsDialog({
    fitTo, kb, initialSection = 'behavior', draft, onDraftChange, onSave, onDelete, onClose, flags, onFlagsChange, dirty,
}: KbSettingsDialogProps) {
    const { t, language } = useTheme();
    const { showConfirm } = useModalContext();
    const [section, setSection] = useState<KbSettingsSection>(initialSection);
    const [status, setStatus] = useState<SaveStatus>('idle');
    const saving = status === 'saving';

    // The fixed RAG answer instructions every turn appends after this KB's
    // prompt — shown read-only so the owner sees what theirs is combined with.
    const [ragPrompt, setRagPrompt] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        axios.get<{ prompt: string }>(`${API_BASE_URL}/api/chat/rag-system-prompt`, { params: { lang: language } })
            .then(res => { if (!cancelled) setRagPrompt(res.data.prompt); })
            .catch(() => { if (!cancelled) setRagPrompt(''); });
        return () => { cancelled = true; };
    }, [language]);

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
    const [membersRevision, setMembersRevision] = useState(0);
    const setRoleDraft = (userId: string, role: KbAssignableRole | null) => setRoleDrafts(prev => {
        const next = { ...prev };
        if (role) next[userId] = role; else delete next[userId];
        return next;
    });
    const anyDirty = dirty || Object.keys(roleDrafts).length > 0;

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
        const rolesSaved = await saveRoleDrafts();
        return kbSaved && rolesSaved;
    };

    const requestClose = async () => {
        if (saving) return;
        if (anyDirty && !await showConfirm(t('kbSettingsDiscardMessage'), t('kbSettingsDiscardTitle'), {
            tone: 'destructive', confirmLabel: t('kbSettingsDiscardConfirm'),
        })) return;
        onClose();
    };

    // "Gespeichert" holds only until the next edit; an error stays until the
    // next attempt, so it is still readable after the user starts fixing it.
    let statusText: string | null = null;
    if (status === 'saving') statusText = t('saving');
    else if (status === 'error') statusText = t('settingsUpdateError');
    else if (!anyDirty) statusText = status === 'saved' ? t('kbSettingsSaved') : t('kbSettingsNoChanges');

    const behavior = (
        <div className="flex flex-col gap-6 pt-6">
            <PanelSection
                title={<label htmlFor="chat-system-prompt">{t('systemPromptLabel')}</label>}
                titleId="kb-own-prompt-title"
                aside={<span aria-live="polite">{draft.length} / {MAX_LEN}</span>}
                hint={t('systemPromptDescription')}
            >
                <Textarea
                    id="chat-system-prompt"
                    value={draft}
                    onChange={(e) => onDraftChange(e.target.value)}
                    placeholder={t('systemPromptPlaceholder')}
                    maxLength={MAX_LEN}
                    className="min-h-48"
                />
            </PanelSection>

            <PanelSection title={t('ragSystemPromptLabel')} titleId="kb-rag-prompt-title" hint={t('ragSystemPromptHint')}>
                {/* Read-only textarea: selectable, scrollable, announced as read-only. */}
                <Textarea
                    readOnly
                    aria-labelledby="kb-rag-prompt-title"
                    value={ragPrompt === null ? '…' : ragPrompt || t('ragSystemPromptUnavailable')}
                    className="min-h-72"
                />
            </PanelSection>
        </div>
    );

    return (
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
                    value: 'behavior',
                    label: t('kbSettingsTabBehavior'),
                    icon: <SlidersHorizontal aria-hidden="true" />,
                    keywords: [t('systemPromptLabel'), t('ragSystemPromptLabel'), t('kbSettingsKeywordsBehavior')],
                    content: behavior,
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
            ]}
            footer={addingMembers ? (
                <div ref={setFooterSlot} className="ml-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" />
            ) : (
                <>
                    <div className="flex items-center gap-3">
                        {section === 'behavior' && (
                            <Button variant="ghost" onClick={() => void run(onDelete)} disabled={saving}>
                                <Trash2 size={16} aria-hidden="true" />
                                {t('delete')}
                            </Button>
                        )}
                        <span
                            className={`text-sm ${status === 'error' ? 'text-error' : 'text-on-surface-variant'}`}
                            role={status === 'error' ? 'alert' : 'status'}
                        >
                            {statusText}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => void requestClose()} disabled={saving}>{t('cancel')}</Button>
                        <Button onClick={() => void run(save)} disabled={!anyDirty || saving}>
                            {saving
                                ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                : <Check size={16} aria-hidden="true" />}
                            {t('save')}
                        </Button>
                    </div>
                </>
            )}
        />
    );
}
