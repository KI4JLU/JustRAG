import React, { memo, useState } from 'react';
import { Plus, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { SourceModal } from './SourceModal';
import { SyncScheduleSelect } from './SyncScheduleSelect';
import type { SyncSchedule } from '../../types';
import { normalizeRepoUrl } from '../../utils/repoUrl';
import { useGitRepoLookup, type GitRepoLookupFailure } from '../../hooks/useGitRepoLookup';

interface GitRepoModalProps {
    kbId: string;
    show: boolean;
    onClose: () => void;
    loading: boolean;
    onAdd: (data: { repoUrl: string; isPrivate: boolean; accessToken?: string; branch?: string; syncSchedule?: SyncSchedule }) => void;
}

const FAILURE_KEYS: Record<GitRepoLookupFailure, string> = {
    not_found: 'gitRepoLookupNotFound',
    auth_failed: 'gitRepoLookupAuthFailed',
    empty: 'gitRepoLookupEmpty',
    unreachable: 'gitRepoLookupUnreachable',
    check_failed: 'gitRepoLookupCheckFailed',
};

const hintStyle: React.CSSProperties = { margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' };

const GitRepoModalComp: React.FC<GitRepoModalProps> = ({ kbId, show, onClose, loading, onAdd }) => {
    const { t } = useTheme();
    const [isPrivate, setIsPrivate] = useState(false);
    const [repoUrl, setRepoUrl] = useState('');
    const [accessToken, setAccessToken] = useState('');
    // The branch the user picked or pasted; null = none chosen, so a branch
    // a typed /tree/<b> link names applies. '' = the repository's default
    // branch, so a later rename of that branch on the forge doesn't break
    // the sync.
    const [chosenBranch, setBranch] = useState<string | null>(null);
    // Free text for a branch the truncated list doesn't show.
    const [otherBranch, setOtherBranch] = useState('');
    const [syncSchedule, setSyncSchedule] = useState<SyncSchedule>('manual');
    // What a paste cut off, shown under the field so the reduction is visible.
    const [shortened, setShortened] = useState<{ removed: string; branch: string } | null>(null);

    const lookup = useGitRepoLookup(kbId, repoUrl, accessToken, isPrivate, show);
    const branch = chosenBranch ?? normalizeRepoUrl(repoUrl)?.branch ?? '';

    // The default branch is stored as '' too, and a branch named by a pasted
    // /tree/<b> link that the repository doesn't have falls back to it. A
    // truncated list can't prove a branch missing, so the link's branch stays
    // and gets its own option.
    const unlisted = lookup.status === 'ok' && branch !== '' && !lookup.branches.includes(branch);
    const keepUnlisted = unlisted && lookup.status === 'ok' && lookup.truncated;
    const effectiveBranch = lookup.status === 'ok' && (branch === lookup.defaultBranch || (unlisted && !keepUnlisted)) ? '' : branch;

    // The repository must be confirmed. A check that failed for its own
    // reasons (rate limit, network) says nothing about the repository, so it
    // doesn't block — the server still validates on save.
    const confirmed = lookup.status === 'ok' || (lookup.status === 'error' && lookup.reason === 'check_failed');
    const valid = normalizeRepoUrl(repoUrl) !== null && (!isPrivate || accessToken.trim() !== '') && confirmed;
    const lookupRefused = lookup.status === 'error' && lookup.reason !== 'check_failed';

    // A link copied from a forge page (pull requests, a file view) is reduced
    // to the repository URL right away — the server does the same on save, so
    // the field shows what will actually be cloned.
    const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const pasted = e.clipboardData.getData('text').trim();
        const n = normalizeRepoUrl(pasted);
        if (!n || n.url === pasted) return;
        e.preventDefault();
        setRepoUrl(n.url);
        const fillBranch = n.branch !== '' && !chosenBranch;
        if (fillBranch) setBranch(n.branch);
        const removed = pasted.toLowerCase().startsWith(n.url.toLowerCase()) ? pasted.slice(n.url.length) : '';
        setShortened({ removed, branch: fillBranch ? n.branch : '' });
    };

    const handleSubmit = () => {
        if (!valid) return;
        onAdd({
            repoUrl: normalizeRepoUrl(repoUrl)?.url ?? repoUrl.trim(),
            isPrivate,
            accessToken: isPrivate ? accessToken.trim() : undefined,
            branch: effectiveBranch || undefined,
            syncSchedule,
        });
        setRepoUrl('');
        setAccessToken('');
        setBranch(null);
        setOtherBranch('');
        setIsPrivate(false);
        setSyncSchedule('manual');
        setShortened(null);
        onClose();
    };

    const describedBy = [shortened ? 'git-repo-url-shortened' : '', 'git-repo-lookup-status'].filter(Boolean).join(' ');

    return (
        <SourceModal title={t('gitRepo')} show={show} onClose={onClose}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('gitRepoDesc')}</p>
            <div role="radiogroup" aria-label={t('gitRepo')} style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer' }}>
                    <input
                        type="radio"
                        name="git-visibility"
                        checked={!isPrivate}
                        onChange={() => setIsPrivate(false)}
                    />
                    {t('gitRepoPublic')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer' }}>
                    <input
                        type="radio"
                        name="git-visibility"
                        checked={isPrivate}
                        onChange={() => setIsPrivate(true)}
                    />
                    {t('gitRepoPrivate')}
                </label>
            </div>
            <input
                type="url"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => { setRepoUrl(e.target.value); setShortened(null); }}
                onPaste={handleUrlPaste}
                aria-label={t('gitRepoUrl')}
                aria-describedby={describedBy}
                aria-invalid={lookupRefused || undefined}
                className="sidebar-left__tools-input"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- focus first field on dialog open (WAI-ARIA dialog pattern)
                autoFocus
            />
            {shortened && (
                <p id="git-repo-url-shortened" style={hintStyle}>
                    {t('gitRepoUrlShortened')}
                    {shortened.removed && <> {t('gitRepoUrlRemoved')} <s>{shortened.removed}</s></>}
                    {shortened.branch && <> · {t('gitRepoBranchFromUrl').replace('{branch}', shortened.branch)}</>}
                </p>
            )}
            {isPrivate && (
                <input
                    type="password"
                    placeholder={t('gitRepoToken')}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    aria-label={t('gitRepoToken')}
                    className="sidebar-left__tools-input"
                />
            )}
            <p
                id="git-repo-lookup-status"
                role="status"
                style={{
                    ...hintStyle,
                    display: lookup.status === 'idle' ? 'none' : 'flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    color: lookupRefused ? 'var(--error-text)' : hintStyle.color,
                }}
            >
                {lookup.status === 'checking' && <><Loader2 className="animate-spin" size={14} aria-hidden="true" />{t('gitRepoLookupChecking')}</>}
                {lookup.status === 'ok' && (
                    <>
                        <CheckCircle2 size={14} aria-hidden="true" />
                        {t('gitRepoLookupFound').replace('{n}', String(lookup.branches.length))}
                        {lookup.truncated && ` ${t('gitRepoLookupTruncated')}`}
                    </>
                )}
                {lookup.status === 'error' && <><AlertCircle size={14} aria-hidden="true" />{t(FAILURE_KEYS[lookup.reason])}</>}
            </p>
            <div className="sidebar-left__slider-row">
                <label htmlFor="git-repo-branch">{t('gitRepoBranchLabel')}</label>
                <select
                    id="git-repo-branch"
                    value={lookup.status === 'ok' ? effectiveBranch : ''}
                    onChange={(e) => { setBranch(e.target.value); setOtherBranch(''); }}
                    disabled={lookup.status !== 'ok' || lookup.branches.length === 0}
                    className="sidebar-left__tools-select"
                >
                    {/* '' stands for the default branch: the sync follows it even if it is renamed later. */}
                    <option value="">
                        {lookup.status === 'ok' && lookup.defaultBranch
                            ? t('gitRepoBranchDefaultOption').replace('{branch}', lookup.defaultBranch)
                            : t('gitRepoBranchPlaceholder')}
                    </option>
                    {keepUnlisted && <option value={branch}>{branch}</option>}
                    {lookup.status === 'ok' && lookup.branches.filter((b) => b !== lookup.defaultBranch).map((b) => (
                        <option key={b} value={b}>{b}</option>
                    ))}
                </select>
            </div>
            {lookup.status === 'ok' && lookup.truncated && (
                // The list stops at 500; a branch past that (or one a
                // /tree/ link can't name, like "feature/x") is typed here.
                <input
                    type="text"
                    placeholder={t('gitRepoBranchOther')}
                    value={otherBranch}
                    onChange={(e) => { setOtherBranch(e.target.value); setBranch(e.target.value.trim() || null); }}
                    aria-label={t('gitRepoBranchOther')}
                    className="sidebar-left__tools-input"
                />
            )}
            <SyncScheduleSelect id="git-repo-schedule" value={syncSchedule} onChange={setSyncSchedule} />
            <button
                onClick={handleSubmit}
                disabled={loading || !valid}
                className="search-button"
            >
                {loading ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                {t('addGitRepo')}
            </button>
        </SourceModal>
    );
};

export const GitRepoModal = memo(GitRepoModalComp);
