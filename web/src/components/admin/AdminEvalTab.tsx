import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { Play, RefreshCw, Download, Copy, Trash2, BarChart3, X, AlertCircle, Check, Upload } from 'lucide-react';
import {
    Button,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useReducedMotion, getMotionProps } from '../../hooks/useReducedMotion';
import { getApiErrorMessage } from '../../utils/apiError';
import { fetchKbAgents, type KbAgentOption } from '../agents/api';
import { CheckboxFieldRow, FieldRow, SelectFieldRow } from '../form/FieldRow';

// Types mirror the backend DTOs (internal/admineval/types.go).
interface AggregateSummary {
    count: number;
    mean_recall: number;
    mrr: number;
}

interface RunSummary {
    id: string;
    label: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    created_at: string;
    started_at?: string;
    finished_at?: string;
    kb_id: string;
    kb_name?: string;
    judge_enabled: boolean;
    aggregate?: AggregateSummary;
    route_mean_recall?: Record<string, number>;
    error_message?: string;
}

interface ListRunsResponse {
    runs: RunSummary[];
    total: number;
}

interface GoldenSet {
    id: string;
    name: string;
    description?: string;
    content_hash: string;
    question_count: number;
    created_at: string;
}

interface ListGoldenSetsResponse {
    golden_sets: GoldenSet[];
}

interface CreateGoldenSetResponse {
    id: string;
    name: string;
    content_hash: string;
    question_count: number;
    created_at: string;
}

interface AdminEvalTabProps {
  /** API base for eval endpoints.
   *  Admin (default): the global admin eval prefix.
   *  KB-scoped: `/api/kb/${kbId}/eval`. */
  basePath?: string;
  /** When set, the tab is KB-scoped: kb_id pickers are hidden and kb_id is
   *  taken from the path, not the form. */
  kbId?: string;
}

export default function AdminEvalTab({ basePath = '/api/admin/eval', kbId }: AdminEvalTabProps) {
    const reducedMotion = useReducedMotion();
    const { t } = useTheme();
    const toast = useToast();

    // State: kick-off form
    const [label, setLabel] = useState('');
    const [formKbId, setFormKbId] = useState('');
    const [selectedGoldenSetId, setSelectedGoldenSetId] = useState<string>('');
    /**
     * Whether the kick-off form has been submitted at least once. The golden-set
     * field's error message is DERIVED from this plus the field's own value
     * (see `goldenSetError` below) rather than stored: stored error state would
     * have to be cleared again on every path that fills the field — the user
     * picking a set, and handleUpload auto-selecting a freshly uploaded one —
     * and a missed one leaves a stale message under a filled field.
     */
    const [kickOffAttempted, setKickOffAttempted] = useState(false);
    const [judgeEnabled, setJudgeEnabled] = useState(true);
    const [topK, setTopK] = useState(10);
    const [kickOffLoading, setKickOffLoading] = useState(false);
    const [selectedTeamId, setSelectedTeamId] = useState('');
    const [kbTeams, setKbTeams] = useState<KbAgentOption[]>([]);

    // State: golden sets
    const [goldenSets, setGoldenSets] = useState<GoldenSet[]>([]);
    const [uploadName, setUploadName] = useState('');
    const [uploadDescription, setUploadDescription] = useState('');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadLoading, setUploadLoading] = useState(false);
    const [uploadKbId, setUploadKbId] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // State: generate from corpus
    const [genKbId, setGenKbId] = useState('');
    const [genName, setGenName] = useState('');
    const [genLang, setGenLang] = useState<'de' | 'en'>('de');
    const [genLookup, setGenLookup] = useState(20);
    const [genComplex, setGenComplex] = useState(10);
    const [genEnum, setGenEnum] = useState(5);
    const [genMultihop, setGenMultihop] = useState(5);
    const [genJobs, setGenJobs] = useState<Array<{ id: string; status: string; error?: string; golden_set_id?: string }>>([]);

    // State: history + pagination
    const [runs, setRuns] = useState<RunSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [listLoading, setListLoading] = useState(false);

    // State: compare
    const [compareAId, setCompareAId] = useState<string>('');
    const [compareBId, setCompareBId] = useState<string>('');
    const [compareMarkdown, setCompareMarkdown] = useState<string>('');
    const [compareLoading, setCompareLoading] = useState(false);

    // Fetch golden sets
    const fetchGoldenSets = useCallback(async () => {
        try {
            const response = await axios.get<ListGoldenSetsResponse>(
                `${API_BASE_URL}${basePath}/golden-sets`
            );
            setGoldenSets(response.data.golden_sets || []);
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalGoldenSetsFetchFailed')));
        }
    }, [basePath, t, toast]);

    useEffect(() => {
        fetchGoldenSets();
    }, [fetchGoldenSets]);

    // Team select: only meaningful once a KB is in play (path-scoped kbId,
    // or an explicit kb_id typed into the admin-scope form).
    useEffect(() => {
        // Clear on every KB change (including formKbId edits) so switching
        // KB-A -> KB-B never resubmits KB-A's team id against KB-B; the
        // backend already 400s that mismatch, this just avoids the
        // confusing error by not offering a stale selection in the first
        // place.
        setSelectedTeamId('');
        const effectiveKb = kbId || formKbId;
        if (!effectiveKb) { setKbTeams([]); return; }
        fetchKbAgents(effectiveKb).then(o => setKbTeams(o.teams)).catch(() => setKbTeams([]));
    }, [kbId, formKbId]);

    // Fetch generation jobs
    const fetchGenJobs = useCallback(async () => {
        try {
            const res = await axios.get<{ jobs: Array<{ id: string; status: string; error?: string; golden_set_id?: string }> }>(
                `${API_BASE_URL}${basePath}/golden-sets/jobs`
            );
            setGenJobs(res.data.jobs || []);
        } catch { /* non-fatal */ }
    }, [basePath]);

    const genInFlight = useMemo(() => genJobs.some(j => j.status === 'queued' || j.status === 'running'), [genJobs]);

    useEffect(() => {
        fetchGenJobs();
        if (!genInFlight) return;
        const iv = setInterval(() => { fetchGenJobs(); fetchGoldenSets(); }, 5000);
        return () => clearInterval(iv);
    }, [fetchGenJobs, fetchGoldenSets, genInFlight]);

    const handleGenerate = async (e: FormEvent) => {
        e.preventDefault();
        if ((!kbId && !genKbId.trim()) || !genName.trim()) { toast.error(t('evalGenFailed')); return; }
        try {
            await axios.post(`${API_BASE_URL}${basePath}/golden-sets/generate`, {
                ...(kbId ? {} : { kb_id: genKbId.trim() }),
                name: genName.trim(), lang: genLang,
                counts: { lookup: genLookup, complex: genComplex, enumeration: genEnum, multihop: genMultihop },
            });
            toast.success(t('evalGenQueued'));
            fetchGenJobs();
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalGenFailed')));
        }
    };

    const handleDownloadGoldenSet = async (id: string, name: string) => {
        try {
            const res = await axios.get<{ content?: unknown[] }>(`${API_BASE_URL}${basePath}/golden-sets/${id}`);
            const lines = (res.data.content || []).map(q => JSON.stringify(q)).join('\n');
            const blob = new Blob([lines], { type: 'application/x-ndjson' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${name}.jsonl`; a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalGoldenSetsFetchFailed')));
        }
    };

    // Fetch list — axios has a global Authorization header set by App.tsx; no per-call header needed.
    const fetchRuns = useCallback(async () => {
        setListLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('limit', '50');
            params.set('offset', String(offset));
            if (statusFilter) params.set('status', statusFilter);
            const response = await axios.get<ListRunsResponse>(
                `${API_BASE_URL}${basePath}/runs?${params.toString()}`
            );
            setRuns(response.data.runs);
            setTotal(response.data.total);
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalFetchFailed')));
        } finally {
            setListLoading(false);
        }
    }, [basePath, offset, statusFilter, toast, t]);

    // Poll while any run is queued/running
    const hasInFlight = useMemo(() => runs.some(r => r.status === 'queued' || r.status === 'running'), [runs]);
    useEffect(() => {
        fetchRuns();
        if (!hasInFlight) return;
        const interval = setInterval(fetchRuns, 5000);
        return () => clearInterval(interval);
    }, [fetchRuns, hasInFlight]);

    /**
     * The golden-set field's validation message. Shown once a submit has been
     * attempted and the field is still empty; it disappears again the moment a
     * set is selected, whichever path sets it.
     */
    const goldenSetError = kickOffAttempted && !selectedGoldenSetId
        ? t('evalSelectGoldenSet')
        : undefined;

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!uploadFile || !uploadName.trim()) {
            toast.error(t('evalGoldenSetMissingFields'));
            return;
        }
        // In admin (non-KB-scoped) mode, kb_id is required.
        if (!kbId && !uploadKbId.trim()) {
            toast.error(t('evalGoldenSetMissingFields'));
            return;
        }
        setUploadLoading(true);
        try {
            const formData = new FormData();
            formData.append('name', uploadName.trim());
            if (uploadDescription.trim()) formData.append('description', uploadDescription.trim());
            formData.append('file', uploadFile);
            // KB-scoped mode: kb_id comes from the path (CreateGoldenSetForKB).
            // Admin mode: must be supplied explicitly.
            if (!kbId) formData.append('kb_id', uploadKbId.trim());

            const response = await axios.post<CreateGoldenSetResponse>(
                `${API_BASE_URL}${basePath}/golden-sets`,
                formData,
                { headers: { 'Content-Type': 'multipart/form-data' } }
            );
            toast.success(t('evalGoldenSetUploaded'));
            setUploadName('');
            setUploadDescription('');
            setUploadFile(null);
            setUploadKbId('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            fetchGoldenSets();
            // Auto-select the newly-uploaded set
            setSelectedGoldenSetId(response.data.id);
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalGoldenSetUploadFailed')));
        } finally {
            setUploadLoading(false);
        }
    };

    const handleDeleteGoldenSet = async (id: string, name: string) => {
        if (!window.confirm(`${t('evalGoldenSetConfirmDelete')} "${name}"?`)) return;
        try {
            await axios.delete(`${API_BASE_URL}${basePath}/golden-sets/${id}`);
            toast.success(t('evalGoldenSetDeleted'));
            if (selectedGoldenSetId === id) setSelectedGoldenSetId('');
            fetchGoldenSets();
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalGoldenSetDeleteFailed')));
        }
    };

    const handleKickOff = async (e: React.FormEvent) => {
        e.preventDefault();
        setKickOffAttempted(true);
        // Field-level validation failure: it names one field, so it renders ON
        // that field through FieldRow's `error` -> FormMessage (card KI-710).
        // The toasts in this file stay where they report a REQUEST outcome.
        if (!selectedGoldenSetId) return;
        setKickOffLoading(true);
        try {
            const body: Record<string, unknown> = {
                label,
                judge_enabled: judgeEnabled,
                top_k: topK,
            };
            if (!kbId && formKbId) body.kb_id = formKbId;
            if (selectedGoldenSetId) body.golden_set_id = selectedGoldenSetId;
            if (selectedTeamId) body.team_id = selectedTeamId;
            await axios.post(`${API_BASE_URL}${basePath}/runs`, body);
            toast.success(t('evalKickedOff'));
            setLabel('');
            fetchRuns();
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalKickOffFailed')));
        } finally {
            setKickOffLoading(false);
        }
    };

    const handleDelete = async (id: string, status: RunSummary['status']) => {
        if (status === 'running') {
            toast.error(t('evalCannotDeleteRunning'));
            return;
        }
        if (!window.confirm(t('evalConfirmDelete'))) return;
        try {
            await axios.delete(`${API_BASE_URL}${basePath}/runs/${id}`);
            toast.success(t('evalDeleted'));
            fetchRuns();
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalDeleteFailed')));
        }
    };

    const handleExport = async (id: string, compareWith?: string, download = false) => {
        try {
            const url = compareWith
                ? `${API_BASE_URL}${basePath}/runs/${id}/export?compare_with=${compareWith}`
                : `${API_BASE_URL}${basePath}/runs/${id}/export`;
            const response = await axios.get<string>(url, {
                responseType: 'text',
            });
            if (download) {
                const blob = new Blob([response.data], { type: 'text/markdown' });
                const dlUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = dlUrl;
                a.download = compareWith
                    ? `eval-delta-${id.slice(0, 8)}-${compareWith.slice(0, 8)}.md`
                    : `eval-run-${id.slice(0, 8)}.md`;
                a.click();
                URL.revokeObjectURL(dlUrl);
                toast.success(t('evalDownloaded'));
            } else {
                await navigator.clipboard.writeText(response.data);
                toast.success(t('evalCopied'));
            }
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalExportFailed')));
        }
    };

    const handleCompare = async () => {
        if (!compareAId || !compareBId) {
            toast.error(t('evalSelectBothRuns'));
            return;
        }
        setCompareLoading(true);
        try {
            const response = await axios.get<string>(
                `${API_BASE_URL}${basePath}/runs/${compareAId}/export?compare_with=${compareBId}`,
                { responseType: 'text' }
            );
            setCompareMarkdown(response.data);
        } catch (err) {
            toast.error(getApiErrorMessage(err, t('evalCompareFailed')));
        } finally {
            setCompareLoading(false);
        }
    };

    // Render: three sections
    return (
        <motion.div {...getMotionProps(reducedMotion)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="result-card" style={{ padding: '2rem' }}>
            <h3 style={{ marginTop: 0 }}>{t('evalRunner')}</h3>
            <p style={{ opacity: 0.7 }}>{t('evalRunnerDesc')}</p>

            {/* Golden sets panel */}
            <div style={{ marginTop: '2rem', padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>{t('evalGoldenSets')}</h4>
                <p style={{ opacity: 0.7, fontSize: '0.9rem', margin: '0 0 1rem 0' }}>{t('evalGoldenSetsDesc')}</p>

                {/* Existing sets */}
                {goldenSets.length === 0 ? (
                    <div style={{ opacity: 0.6, fontSize: '0.9rem', padding: '0.5rem 0' }}>{t('evalGoldenSetsEmpty')}</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}>{t('evalGoldenSetName')}</th>
                                <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}>{t('evalQuestionCount')}</th>
                                <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}>{t('evalStarted')}</th>
                                <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}>{t('evalGoldenSetHash')}</th>
                                <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}>{t('evalActions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {goldenSets.map(gs => (
                                <tr key={gs.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '0.3rem 0.5rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            {gs.name}
                                            {(gs.description || '').startsWith('auto-generated from corpus') && (
                                                <span style={{ padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.7rem', background: 'var(--accent-primary)', color: 'white', opacity: 0.8 }}>{t('evalGenDraftBadge')}</span>
                                            )}
                                        </div>
                                        {gs.description && <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{gs.description}</div>}
                                    </td>
                                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{gs.question_count}</td>
                                    <td style={{ padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}>{new Date(gs.created_at).toLocaleString()}</td>
                                    <td style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', opacity: 0.7 }}>{gs.content_hash.slice(0, 12)}</td>
                                    {/* The <table> itself is deliberately untouched — the DS
                                      * TableLayout migration is Stage 5 (card KI-694). Only the
                                      * two raw <button>s inside it are swapped here, because they
                                      * are part of THIS file's catalogue count. */}
                                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>
                                        <Button type="button" variant="ghost" size="icon" onClick={() => handleDownloadGoldenSet(gs.id, gs.name)} title={t('evalDownload')} aria-label={t('evalDownload')}>
                                            <Download size={14} />
                                        </Button>
                                        <Button type="button" variant="ghost-destructive" size="icon" onClick={() => handleDeleteGoldenSet(gs.id, gs.name)} title={t('delete')} aria-label={t('delete')}>
                                            <Trash2 size={14} />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {/* Generate from corpus */}
                <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('evalGenerateTitle')}</div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>{t('evalGenerateHint')}</div>
                    {/* The three fields in this row had a placeholder and no label at
                      * all, so they had no accessible name; the aria-labels are new. The
                      * ids they carried (`gen-kb-id`, `gen-name`, `gen-lang`) were
                      * referenced by nothing — no <label htmlFor>, no CSS, no test, and
                      * the submit path POSTs component state rather than FormData
                      * (checked across web/ and go-backend/) — so they are dropped.
                      *
                      * The kb_id fields use the body font, like every field: monospace
                      * is for code-box content only (developer, 24.09.2026), and
                      * `design-system/layout-only-classname` forbids a font family on a
                      * DS control anyway. Do NOT re-add `font-mono` here. */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {!kbId && (
                        <Input
                            type="text"
                            aria-label={t('evalKbId')}
                            value={genKbId}
                            onChange={e => setGenKbId(e.target.value)}
                            placeholder="kb_id"
                            className="min-w-[200px] flex-1"
                        />
                        )}
                        <Input
                            type="text"
                            aria-label={t('evalGenName')}
                            value={genName}
                            onChange={e => setGenName(e.target.value)}
                            placeholder={t('evalGenName')}
                            className="min-w-[200px] flex-[2]"
                        />
                        <Select value={genLang} onValueChange={value => setGenLang(value as 'de' | 'en')}>
                            <SelectTrigger aria-label={t('evalGenLang')} className="w-[100px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="de">de</SelectItem>
                                <SelectItem value="en">en</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {/* Four count fields. They were a wrapping <label> + <input>; as
                      * FieldRows the label/control pairing comes from FormControl's
                      * injected id instead of the wrapping, and the repeated inline
                      * style object (incl. `width: '80px'`) is gone — the width is now
                      * FieldRow's `width="narrow"`. */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <FieldRow
                            label={t('evalGenLookup')}
                            width="narrow"
                            type="number"
                            min={0}
                            max={200}
                            value={genLookup}
                            onChange={e => setGenLookup(Number(e.target.value))}
                        />
                        <FieldRow
                            label={t('evalGenComplex')}
                            width="narrow"
                            type="number"
                            min={0}
                            max={200}
                            value={genComplex}
                            onChange={e => setGenComplex(Number(e.target.value))}
                        />
                        <FieldRow
                            label={t('evalGenEnumeration')}
                            width="narrow"
                            type="number"
                            min={0}
                            max={200}
                            value={genEnum}
                            onChange={e => setGenEnum(Number(e.target.value))}
                        />
                        <FieldRow
                            label={t('evalGenMultiHop')}
                            width="narrow"
                            type="number"
                            min={0}
                            max={200}
                            value={genMultihop}
                            onChange={e => setGenMultihop(Number(e.target.value))}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Button type="submit" size="sm" disabled={genInFlight}>
                            {genInFlight ? t('evalGenRunning') : t('evalGenButton')}
                        </Button>
                    </div>
                    {genJobs.length > 0 && (
                        <ul style={{ margin: '0.5rem 0 0 0', padding: '0 0 0 1rem', fontSize: '0.85rem', opacity: 0.8 }}>
                            {genJobs.slice(0, 5).map(j => (
                                <li key={j.id}>{j.status}{j.error ? ` — ${j.error}` : ''}</li>
                            ))}
                        </ul>
                    )}
                </form>

                {/* Upload form */}
                <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('evalGoldenSetUpload')}</div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {!kbId && (
                        <Input
                            type="text"
                            aria-label={t('evalKbId')}
                            value={uploadKbId}
                            onChange={e => setUploadKbId(e.target.value)}
                            placeholder="kb_id"
                            className="min-w-[200px] flex-1"
                        />
                        )}
                        <Input
                            type="text"
                            aria-label={t('evalGoldenSetName')}
                            value={uploadName}
                            onChange={e => setUploadName(e.target.value)}
                            placeholder={t('evalGoldenSetName')}
                            required
                            maxLength={255}
                            className="min-w-[200px] flex-1"
                        />
                        <Input
                            type="text"
                            aria-label={t('evalGoldenSetDescription')}
                            value={uploadDescription}
                            onChange={e => setUploadDescription(e.target.value)}
                            placeholder={t('evalGoldenSetDescription')}
                            className="min-w-[200px] flex-[2]"
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {/* The file field keeps its ref (handleUpload clears it after a
                          * successful upload); the DS Input forwards refs to the
                          * underlying <input>, so nothing else had to change.
                          * TODO: a file input inside the DS field frame is not visually
                          * confirmed — the native button sits inside the framed field. */}
                        <Input
                            ref={fileInputRef}
                            type="file"
                            aria-label={t('evalGoldenSetUpload')}
                            accept=".jsonl,.ndjson,application/x-ndjson,text/plain"
                            onChange={e => setUploadFile(e.target.files?.[0] || null)}
                            className="flex-1"
                        />
                        <Button type="submit" size="sm" disabled={uploadLoading || !uploadFile || !uploadName.trim()}>
                            <Upload size={14} />
                            {uploadLoading ? t('loading') : t('evalGoldenSetUpload')}
                        </Button>
                    </div>
                </form>
            </div>

            {/* Section 1: Kick-off form */}
            <form onSubmit={handleKickOff} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem', padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
                {/* Label. The `input-group` wrapper and the per-row inline style
                  * objects are gone (`.input-group` has no CSS rule anywhere in the
                  * repo); the field width is FieldRow's, which caps these rows at
                  * 400px where they previously ran the full width of the card. */}
                <FieldRow
                    label={t('evalLabel')}
                    type="text"
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                    maxLength={255}
                    placeholder={t('evalLabelPlaceholder')}
                />
                {/* KB ID — hidden when the tab is already scoped to a KB */}
                {!kbId && (
                <FieldRow
                    label={t('evalKbId')}
                    type="text"
                    value={formKbId}
                    onChange={e => setFormKbId(e.target.value)}
                    placeholder={t('evalKbIdPlaceholder')}
                />
                )}
                {/* Golden set selector. The old `<option value="">` prompt is the
                  * trigger PLACEHOLDER here: Radix reads value '' as "nothing
                  * selected", so a listed item with that value could never show on
                  * the trigger. Nothing is lost — the prompt was never a submittable
                  * choice.
                  *
                  * The native `required` this row carried until card KI-710 is gone:
                  * Radix put it on a visually hidden <select>, where the browser's
                  * refusal to submit has nowhere to render its bubble (Chrome logs
                  * "An invalid form control ... is not focusable" and the user sees
                  * nothing at all). handleKickOff's own guard is the single source of
                  * truth now, and its message renders here. */}
                <SelectFieldRow
                    label={t('evalGoldenSet')}
                    placeholder={t('evalPickGoldenSet')}
                    error={goldenSetError}
                    value={selectedGoldenSetId}
                    onValueChange={setSelectedGoldenSetId}
                    options={goldenSets.map(gs => ({
                        value: gs.id,
                        label: `${gs.name} (${gs.question_count} ${t('evalQuestions')})`,
                    }))}
                />
                {/* Team selector — only shown once a KB is in play (its teams may be empty) */}
                {kbTeams.length > 0 && (
                <SelectFieldRow
                    label={t('evalTeamLabel')}
                    // '' is a real choice here ("standard, no team"), so it stays a
                    // listed option AND supplies the placeholder — Radix shows the
                    // placeholder for value '', so the wording has to exist twice for
                    // the trigger and the list to read the same.
                    placeholder={t('evalTeamStandard')}
                    value={selectedTeamId}
                    onValueChange={setSelectedTeamId}
                    options={[
                        { value: '', label: t('evalTeamStandard') },
                        ...kbTeams.map(tm => ({ value: tm.id, label: tm.name })),
                    ]}
                />
                )}
                {/* Top-k + judge + submit row */}
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <FieldRow
                        label={t('evalTopK')}
                        width="narrow"
                        type="number"
                        min={1}
                        max={100}
                        value={topK}
                        onChange={e => setTopK(parseInt(e.target.value, 10) || 10)}
                    />
                    {/* Checkbox, not Switch: judge mode is staged until "Run eval" is
                      * pressed, so a switch would claim the change already applies. */}
                    <CheckboxFieldRow
                        label={t('evalJudge')}
                        checked={judgeEnabled}
                        onCheckedChange={setJudgeEnabled}
                    />
                    {/* `!selectedGoldenSetId` is deliberately NOT a disabled reason
                      * any more (card KI-710). A disabled submit button is a third
                      * validation mechanism on top of the native constraint and the
                      * app guard, and it is the one that explains nothing: with it,
                      * HTML implicit submission does nothing either (the spec only
                      * fires the default button when that button is not disabled —
                      * verified in jsdom), so pressing Enter in the label field was
                      * a dead end. Enter now reaches handleKickOff, which puts the
                      * reason on the field. `kickOffLoading`/`hasInFlight` stay:
                      * those are request state, not form validity. */}
                    <Button type="submit" disabled={kickOffLoading || hasInFlight}>
                        <Play size={16} />
                        {kickOffLoading ? t('evalKickingOff') : t('evalKickOff')}
                    </Button>
                </div>
                {/* Warnings */}
                {judgeEnabled && (
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <AlertCircle size={14} />
                        {t('evalJudgeWarning')}
                    </div>
                )}
                {hasInFlight && (
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <RefreshCw size={14} />
                        {t('evalInFlight')}
                    </div>
                )}
            </form>

            {/* Section 2: History table */}
            <div style={{ marginTop: '2.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h4 style={{ margin: 0 }}>{t('evalHistory')}</h4>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {/* A filter, not a form field: no visible label existed and none
                          * is added, so the accessible name is an aria-label on the
                          * trigger. '' ("all") stays a listed item and doubles as the
                          * placeholder, since Radix shows the placeholder for value ''. */}
                        <Select
                            value={statusFilter}
                            onValueChange={value => { setStatusFilter(value); setOffset(0); }}
                        >
                            <SelectTrigger aria-label={t('evalStatus')} className="w-[180px]">
                                <SelectValue placeholder={t('evalFilterAll')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="">{t('evalFilterAll')}</SelectItem>
                                <SelectItem value="queued">{t('evalStatusQueued')}</SelectItem>
                                <SelectItem value="running">{t('evalStatusRunning')}</SelectItem>
                                <SelectItem value="completed">{t('evalStatusCompleted')}</SelectItem>
                                <SelectItem value="failed">{t('evalStatusFailed')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="sm" onClick={fetchRuns}>
                            <RefreshCw size={14} /> {t('evalRefresh')}
                        </Button>
                    </div>
                </div>
                {listLoading && <div style={{ opacity: 0.6 }}>{t('loading')}...</div>}
                {!listLoading && runs.length === 0 && <div style={{ opacity: 0.6 }}>{t('evalNoRuns')}</div>}
                {!listLoading && runs.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('evalStatus')}</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('evalLabel')}</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('evalStarted')}</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>{t('evalDuration')}</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('evalKbName')}</th>
                                <th style={{ textAlign: 'center', padding: '0.5rem' }}>{t('evalJudge')}</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('evalRecallPerRoute')}</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>{t('evalActions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map(r => <RunRow key={r.id} run={r} onDelete={handleDelete} onExport={handleExport} onCompareWith={(cmpId) => { setCompareAId(r.id); setCompareBId(cmpId); setCompareMarkdown(''); }} runs={runs} />)}
                        </tbody>
                    </table>
                )}
                {total > 50 && (
                    <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center' }}>
                        <Button type="button" variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>{t('prev')}</Button>
                        <span style={{ padding: '0.3rem 0.5rem' }}>{offset + 1} – {Math.min(offset + 50, total)} / {total}</span>
                        <Button type="button" variant="outline" size="sm" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>{t('next')}</Button>
                    </div>
                )}
            </div>

            {/* Section 3: Compare view (conditional) */}
            {compareAId && compareBId && (
                <div style={{ marginTop: '2.5rem', padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <h4 style={{ margin: 0 }}>{t('evalCompare')}</h4>
                        <Button type="button" variant="ghost" size="icon" aria-label={t('close')} onClick={() => { setCompareAId(''); setCompareBId(''); setCompareMarkdown(''); }}><X size={16} /></Button>
                    </div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '1rem' }}>
                        A: <code>{compareAId}</code> → B: <code>{compareBId}</code>
                    </div>
                    {!compareMarkdown && (
                        <Button type="button" onClick={handleCompare} disabled={compareLoading}>
                            <BarChart3 size={16} />
                            {compareLoading ? t('loading') : t('evalRunCompare')}
                        </Button>
                    )}
                    {compareMarkdown && (
                        <>
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                                <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(compareMarkdown).then(() => toast.success(t('evalCopied')))}>
                                    <Copy size={14} /> {t('evalExportMarkdown')}
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => handleExport(compareAId, compareBId, true)}>
                                    <Download size={14} /> {t('evalDownloadMarkdown')}
                                </Button>
                            </div>
                            <pre style={{ padding: '1rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', overflow: 'auto', maxHeight: '600px', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                                {compareMarkdown}
                            </pre>
                        </>
                    )}
                </div>
            )}
        </motion.div>
    );
}

// Sub-component: single run row in the table
function RunRow({ run, onDelete, onExport, onCompareWith, runs }: { run: RunSummary; onDelete: (id: string, status: RunSummary['status']) => void; onExport: (id: string, cmp?: string, dl?: boolean) => void; onCompareWith: (cmpId: string) => void; runs: RunSummary[] }) {
    const { t } = useTheme();
    const [showComparePicker, setShowComparePicker] = useState(false);
    const otherRuns = runs.filter(r => r.id !== run.id && r.status === 'completed');

    const statusBadge = (s: RunSummary['status']) => {
        const colorMap: Record<RunSummary['status'], string> = { queued: '#888', running: 'var(--accent-primary)', completed: '#2d9d4a', failed: '#d93535' };
        return <span style={{ padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.75rem', background: colorMap[s], color: 'white' }}>{s}</span>;
    };

    // Elapsed time for running runs: Date.now() is impure, so it is sampled in
    // an effect (ticking every second while the run is in progress) instead of
    // being called during render.
    const [nowMs, setNowMs] = useState<number | null>(null);
    useEffect(() => {
        if (run.status !== 'running' || !run.started_at) return;
        const update = () => setNowMs(Date.now());
        const immediate = setTimeout(update, 0);
        const interval = setInterval(update, 1000);
        return () => { clearTimeout(immediate); clearInterval(interval); };
    }, [run.status, run.started_at]);

    const duration = run.started_at && run.finished_at
        ? `${Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
        : run.started_at && (run.status === 'running') && nowMs !== null
        ? `${Math.round((nowMs - new Date(run.started_at).getTime()) / 1000)}s …`
        : '—';

    return (
        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
            <td style={{ padding: '0.5rem' }}>{statusBadge(run.status)}</td>
            <td style={{ padding: '0.5rem' }}>{run.label || <span style={{ opacity: 0.5 }}>({t('evalNoLabel')})</span>}</td>
            <td style={{ padding: '0.5rem', fontSize: '0.85rem' }}>{run.started_at ? new Date(run.started_at).toLocaleString() : '—'}</td>
            <td style={{ padding: '0.5rem', textAlign: 'right', fontSize: '0.85rem' }}>{duration}</td>
            <td style={{ padding: '0.5rem', fontSize: '0.85rem' }}>{run.kb_name || run.kb_id.slice(0, 8)}</td>
            <td style={{ padding: '0.5rem', textAlign: 'center' }}>{run.judge_enabled ? <Check size={14} /> : <X size={14} style={{ opacity: 0.3 }} />}</td>
            <td style={{ padding: '0.5rem' }}>
                {run.route_mean_recall
                    ? Object.entries(run.route_mean_recall).map(([route, val]) => (
                        <span key={route} style={{ display: 'inline-block', marginRight: '0.5rem', fontSize: '0.75rem' }}>
                            {route.slice(0, 3)}: {(val * 100).toFixed(0)}%
                        </span>
                    ))
                    : '—'}
            </td>
            <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                <Button type="button" variant="ghost" size="icon" onClick={() => onExport(run.id)} title={t('evalExportSingle')} aria-label={t('evalExportSingle')}><Copy size={14} /></Button>
                {run.status === 'completed' && otherRuns.length > 0 && (
                    <>
                        {/* Disclosure: `aria-expanded`, never `aria-pressed` — a control
                          * cannot be both a toggle button and a disclosure. `data-state`
                          * is Radix's non-ARIA convention and the hook the DS ghost
                          * variant tints on, so it supplies the open-state look without
                          * the semantic conflict (same treatment as AdminAgentTab's
                          * section headers, card KI-691). */}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowComparePicker(!showComparePicker)}
                            aria-expanded={showComparePicker}
                            data-state={showComparePicker ? 'open' : 'closed'}
                            title={t('evalCompareWith')}
                            aria-label={t('evalCompareWith')}
                        >
                            <BarChart3 size={14} />
                        </Button>
                        {showComparePicker && (
                            /* Opened immediately (`open`) so keyboard users land inside
                             * the list, which is what the raw <select>'s autoFocus +
                             * onBlur pair was hand-building; Radix closes on Escape, on
                             * outside click and on select, and every one of those routes
                             * through onOpenChange -> dismiss. That is also why the
                             * jsx-a11y/no-autofocus disable is gone. */
                            <Select
                                open
                                onOpenChange={open => { if (!open) setShowComparePicker(false); }}
                                value=""
                                onValueChange={id => { onCompareWith(id); setShowComparePicker(false); }}
                            >
                                <SelectTrigger aria-label={t('evalCompareWith')} className="ml-1 inline-flex w-[180px]">
                                    <SelectValue placeholder={t('evalPickRun')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {otherRuns.map(r => (
                                        <SelectItem key={r.id} value={r.id}>{r.label || r.id.slice(0, 8)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </>
                )}
                <Button type="button" variant="ghost-destructive" size="icon" onClick={() => onDelete(run.id, run.status)} disabled={run.status === 'running'} title={t('delete')} aria-label={t('delete')}><Trash2 size={14} /></Button>
            </td>
        </tr>
    );
}
