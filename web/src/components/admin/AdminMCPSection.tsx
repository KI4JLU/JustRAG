import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { Alert, AlertDescription, Badge, Button } from '@ki4jlu/design-system';
import { API_BASE_URL, authFetch } from '../../api';
import { CheckboxFieldRow, TextareaFieldRow } from '../form/SettingsFieldRow';
import { useTheme } from '../../contexts/ThemeContext';

// Mirrors mcp.ServerSpec on the backend.
interface ServerSpec {
    name: string;
    url: string;
    headers?: Record<string, string>;
}

// Mirrors mcp.ToolSummary.
interface ToolSummary {
    name: string;
    description?: string;
    origin: string;
}

// Mirrors mcp.ServerStatus.
interface ServerStatus {
    name: string;
    url: string;
    reachable: boolean;
    error?: string;
    tools?: ToolSummary[];
}

// Mirrors adminmcp.StatusResponse.
interface StatusResponse {
    use_mcp_tools: boolean;
    builtins: ToolSummary[];
    servers: ServerStatus[];
    server_spec: ServerSpec[];
}

interface AdminMCPSectionProps {
    siteConfigs: Record<string, string>;
    setSiteConfigs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

// Validates and pretty-prints the mcp_servers JSON the user is editing.
// Returns [parsed, error]. An empty string parses as an empty array so a
// fresh deployment doesn't surface a confusing error.
function parseServers(raw: string, t: (key: string) => string): [ServerSpec[] | null, string | null] {
    const trimmed = raw.trim();
    if (trimmed === '') return [[], null];
    try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) return [null, t('admMcpErrNotArray')];
        for (const s of parsed) {
            if (typeof s !== 'object' || s === null) return [null, t('admMcpErrEntryObject')];
            if (typeof s.name !== 'string' || s.name === '') return [null, t('admMcpErrEntryName')];
            if (typeof s.url !== 'string' || s.url === '') return [null, t('admMcpErrEntryUrl')];
        }
        return [parsed as ServerSpec[], null];
    } catch (e) {
        return [null, (e as Error).message];
    }
}

function ServerStatusBadge({ s }: { s: ServerStatus }) {
    const { t } = useTheme();
    return s.reachable ? (
        <Badge tone="success">
            <CheckCircle2 size={14} aria-hidden="true" /> {t('admMcpReachable')}
        </Badge>
    ) : (
        <Badge tone="error">
            <AlertCircle size={14} aria-hidden="true" /> {t('admMcpUnreachable')}
        </Badge>
    );
}

function ToolList({ tools }: { tools: ToolSummary[] }) {
    const { t: tr } = useTheme();
    if (tools.length === 0) return <em style={{ opacity: 0.6 }}>{tr('admMcpNoTools')}</em>;
    return (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {tools.map(t => (
                <li key={t.name} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <Wrench size={12} aria-hidden="true" />
                    <code style={{ fontWeight: 600 }}>{t.name}</code>
                    {t.description && (
                        <span style={{ opacity: 0.75 }}>— {t.description}</span>
                    )}
                </li>
            ))}
        </ul>
    );
}

function ServerCard({ s }: { s: ServerStatus }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '0.5rem',
            background: 'var(--bg-secondary, transparent)',
        }}>
            <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start gap-2 px-0 py-0 text-left font-normal"
                aria-expanded={open}
                onClick={() => setOpen(v => !v)}
            >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <strong>{s.name}</strong>
                <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>{s.url}</span>
                <span style={{ flex: 1 }} />
                <ServerStatusBadge s={s} />
            </Button>
            {open && (
                <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed var(--border-color)' }}>
                    {s.error && (
                        <Alert tone="error" className="mb-2">
                            <AlertDescription>{s.error}</AlertDescription>
                        </Alert>
                    )}
                    {s.reachable && <ToolList tools={s.tools ?? []} />}
                </div>
            )}
        </div>
    );
}

export default function AdminMCPSection({ siteConfigs, setSiteConfigs }: AdminMCPSectionProps) {
    const { t } = useTheme();
    const [status, setStatus] = useState<StatusResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [reloading, setReloading] = useState(false);
    // Local editor state. Initialized from siteConfigs.mcp_servers; written
    // back to siteConfigs on every keystroke so the parent's "Save settings"
    // button persists it through the existing site_config pipeline.
    const [editor, setEditor] = useState(siteConfigs.mcp_servers ?? '[]');
    const [editorErr, setEditorErr] = useState<string | null>(null);

    // No synchronous setState here: `loading` starts true (initial load) and is
    // flipped on by the Refresh button's handler before re-invoking this.
    const fetchStatus = useCallback(() => {
        authFetch(`${API_BASE_URL}/api/admin/mcp/status`)
            .then(async r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json() as Promise<StatusResponse>;
            })
            .then(setStatus)
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);

    const refreshStatus = useCallback(() => {
        setLoading(true);
        setError(null);
        fetchStatus();
    }, [fetchStatus]);

    const reload = useCallback(() => {
        setReloading(true);
        setError(null);
        authFetch(`${API_BASE_URL}/api/admin/mcp/reload`, { method: 'POST' })
            .then(async r => {
                if (!r.ok) {
                    const body = await r.text();
                    throw new Error(`HTTP ${r.status}: ${body}`);
                }
                return r.json() as Promise<StatusResponse>;
            })
            .then(setStatus)
            .catch(e => setError(String(e)))
            .finally(() => setReloading(false));
    }, []);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    const onEditorChange = (next: string) => {
        setEditor(next);
        const [, perr] = parseServers(next, t);
        setEditorErr(perr);
        // Push valid (or empty-trimmed) values back to siteConfigs so
        // the form's Save settings includes them. Invalid JSON is left
        // unwritten — the user sees the inline error.
        if (!perr) {
            setSiteConfigs(prev => ({ ...prev, mcp_servers: next.trim() === '' ? '[]' : next }));
        }
    };

    const useMCPNow = (siteConfigs.chat_use_mcp_tools ?? '') === 'true' || (siteConfigs.chat_use_mcp_tools ?? '') === '1';

    return (
        <div style={{ marginTop: '2rem', padding: '1.25rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <div style={{ marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0 }}>{t('admMcpTitle')}</h4>
            </div>
            <p style={{ fontSize: '0.85rem', opacity: 0.75, marginTop: 0 }}>
                {t('admMcpIntro')}
            </p>

            {/* Master switch */}
            <div className="mb-4">
                <CheckboxFieldRow
                    width="wide"
                    label={t('admMcpUseRegistry')}
                    checked={useMCPNow}
                    onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_use_mcp_tools: checked ? 'true' : 'false' }))}
                />
            </div>

            {/* Server editor */}
            <div className="mb-4">
                <TextareaFieldRow
                    width="wide"
                    label={t('admMcpServersLabel')}
                    value={editor}
                    onChange={e => onEditorChange(e.target.value)}
                    rows={Math.min(12, Math.max(4, editor.split('\n').length + 1))}
                    spellCheck={false}
                    placeholder={`[\n  {"name": "fetch", "url": "https://my-mcp-server.example.com/mcp", "headers": {"Authorization": "Bearer …"}}\n]`}
                    error={editorErr ? t('admMcpInvalidJson').replace('{error}', editorErr) : undefined}
                    help={<>{t('admMcpFormat')} <code>{`[{name, url, headers?}]`}</code>. {t('admMcpServersHelp')}</>}
                />
            </div>

            {/* Live status panel */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <strong>{t('admMcpLiveStatus')}</strong>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={refreshStatus}
                        disabled={loading || reloading}
                    >
                        {loading ? '…' : t('refresh')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={reload}
                        disabled={loading || reloading}
                        title={t('admMcpReloadTitle')}
                    >
                        <RefreshCw size={14} className={reloading ? 'animate-spin' : undefined} />
                        {reloading ? t('admMcpApplying') : t('admMcpReload')}
                    </Button>
                </div>
            </div>
            {error && (
                <Alert tone="error" live="assertive" className="mb-2">
                    <AlertDescription>{t('admErrorPrefix').replace('{error}', error)}</AlertDescription>
                </Alert>
            )}
            {status && (
                <>
                    {/* Built-ins */}
                    <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.85rem', opacity: 0.85, marginBottom: '0.3rem' }}>
                            {t('admMcpBuiltins').replace('{n}', String(status.builtins.length))}
                        </div>
                        <ToolList tools={status.builtins} />
                    </div>

                    {/* Remote servers */}
                    {status.servers.length === 0 ? (
                        <div style={{ opacity: 0.65, fontSize: '0.85rem' }}>{t('admMcpNoServers')}</div>
                    ) : (
                        <div>
                            <div style={{ fontSize: '0.85rem', opacity: 0.85, marginBottom: '0.3rem' }}>
                                {t('admMcpRemoteServers').replace('{n}', String(status.servers.length))}
                            </div>
                            {status.servers.map(s => <ServerCard key={s.name} s={s} />)}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
