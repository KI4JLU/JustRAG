import { useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
    Avatar, Button, ComboboxItem, ComboboxList, Input, Label, TokenInput, TokenInputChip,
    type TokenInputChipTone,
} from '@ki4jlu/design-system';
import { displayName, initialsOf } from '../../utils/personName';
import { SharingRoleSelect } from './SharingRoleSelect';
import type { SharingRole } from './sharing';
import type { BulkAdd, Candidate } from './useBulkAdd';

const chipStatusKey: Record<Candidate['status'], string> = {
    resolving: 'chipResolving', found: '', pending: 'chipPending', member: 'alreadyMember',
    invalid: 'chipInvalid', failed: 'chipLookupFailed',
};

const chipTone = (c: Candidate): TokenInputChipTone =>
    c.status === 'pending' ? 'warning' : c.status === 'member' || c.status === 'invalid' || c.status === 'failed' ? 'error' : 'default';

interface BulkAddFieldsProps {
    /** The collected names (`useBulkAdd`). */
    bulk: BulkAdd;
    /** The form's id: its submit button may sit in a dialog footer. */
    formId: string;
    roles: readonly SharingRole[];
    role: string;
    onRoleChange: (role: string) => void;
    onSubmit: () => void;
    t: (k: string) => string;
}

/**
 * The "Benutzernamen" tab of adding people: a token field that looks every name up, a CSV
 * import of names, and the role they get. The submit button is the caller's (`form={formId}`).
 */
export function BulkAddFields({ bulk, formId, roles, role, onRoleChange, onSubmit, t }: BulkAddFieldsProps) {
    const [suggestionsOpen, setSuggestionsOpen] = useState(false);
    const usernamesId = useId();
    const usernamesHintId = useId();
    const roleId = useId();
    const csvRef = useRef<HTMLInputElement>(null);
    const { candidates, suggestion } = bulk;

    return (
        <form
            id={formId}
            className="flex flex-col gap-stack-md"
            onSubmit={(e) => { e.preventDefault(); if (!bulk.resolving) onSubmit(); }}
        >
            <div className="flex flex-col gap-stack-sm">
                <div className="flex items-center justify-between gap-stack-sm">
                    <Label id={usernamesId}>{t('usernamesLabel')}</Label>
                    <Button type="button" variant="link" size="sm" onClick={() => csvRef.current?.click()}>
                        {t('uploadCsv')}
                    </Button>
                    <Input
                        ref={csvRef}
                        type="file"
                        accept=".csv,.txt,text/csv,text/plain"
                        hidden
                        aria-label={t('uploadCsv')}
                        onChange={(e) => {
                            void bulk.addCsvFile(e.target.files?.[0]);
                            e.target.value = '';
                        }}
                    />
                </div>
                <p id={usernamesHintId} className="m-0 text-sm text-on-surface-variant">{t('usernamesHint')}</p>
                <TokenInput
                    shouldFilter={false}
                    open={suggestionsOpen && suggestion !== null}
                    onOpenChange={setSuggestionsOpen}
                    aria-labelledby={usernamesId}
                    aria-describedby={usernamesHintId}
                    chipsLabel={t('selectedPeople')}
                    placeholder={candidates.length === 0 ? t('username') : undefined}
                    autoComplete="off"
                    value={bulk.query}
                    onValueChange={bulk.setQuery}
                    onCommit={bulk.addNames}
                    onRemoveLast={() => bulk.setCandidates(prev => prev.slice(0, -1))}
                    suggestions={
                        <ComboboxList label={t('usernamesLabel')}>
                            {suggestion && (
                                <ComboboxItem value={suggestion.username} onSelect={() => bulk.addSuggestion(suggestion)}>
                                    <Avatar size="xs" initials={initialsOf(suggestion.firstName, suggestion.lastName, suggestion.username)} />
                                    <span className="min-w-0">
                                        <span className="block truncate">{displayName(suggestion.firstName, suggestion.lastName, suggestion.username)}</span>
                                        <span className="block truncate text-sm text-on-surface-variant">@{suggestion.username}</span>
                                    </span>
                                    <span aria-hidden="true" className="ml-auto shrink-0 text-xs text-primary">
                                        {bulk.isMember(suggestion.id) ? t('alreadyMember') : t('tabToAdd')}
                                    </span>
                                </ComboboxItem>
                            )}
                        </ComboboxList>
                    }
                >
                    {candidates.map(c => {
                        const label = c.user ? displayName(c.user.firstName, c.user.lastName, c.user.username) : c.typed;
                        const status = chipStatusKey[c.status] ? t(chipStatusKey[c.status]) : '';
                        return (
                            <TokenInputChip
                                key={c.key}
                                label={label}
                                tone={chipTone(c)}
                                leading={c.status === 'resolving'
                                    ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                    : c.user ? <Avatar size="xs" initials={initialsOf(c.user.firstName, c.user.lastName, c.user.username)} /> : undefined}
                                labels={{
                                    remove: (l) => t('removeChip').replace('{label}', l),
                                    warning: status,
                                    error: status,
                                }}
                                onRemove={() => bulk.setCandidates(prev => prev.filter(x => x.key !== c.key))}
                            />
                        );
                    })}
                </TokenInput>
                <div role="status" className="flex flex-col gap-1 text-sm">
                    {bulk.pendingNames.length > 0 && (
                        <p className="m-0 text-on-surface-variant">
                            {t('pendingChipsNotice').replace('{names}', bulk.pendingNames.map(n => `„${n}“`).join(', '))}
                        </p>
                    )}
                    {bulk.skippedNames.length > 0 && (
                        <p className="m-0 text-error">
                            {t('skippedChipsNotice').replace('{names}', bulk.skippedNames.map(n => `„${n}“`).join(', '))}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex flex-col gap-stack-sm">
                <Label htmlFor={roleId}>{t('roleLabel')}</Label>
                <SharingRoleSelect roles={roles} id={roleId} value={role} onChange={onRoleChange} label={t('roleLabel')} t={t} wide />
            </div>
        </form>
    );
}
