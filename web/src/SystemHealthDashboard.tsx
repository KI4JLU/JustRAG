import { useState, useEffect, useCallback, useId } from 'react';
import axios from 'axios';
import { getApiErrorMessage } from './utils/apiError';
import {
    AreaChart, Area, BarChart, Bar, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
    Activity, Users, FileText, Database, HardDrive, Server,
    RefreshCw, Clock, AlertCircle, CheckCircle, AlertTriangle, Cpu, MessageSquare,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
    Button, Card, CardContent, CardHeader, Checkbox, DashboardLayout, Grid, Label,
    SegmentedControl, Spinner, Stack, cn,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from './api';
import { useTheme } from './contexts/ThemeContext';

/* ---------------------------------------------------------------------------
 * Shell: the design system's `DashboardLayout` template (card KI-714,
 * Stage 4b). The template's slot API and how it compares to `AuthLayout`'s two
 * known gaps are documented once, in Dashboard.tsx — read that first.
 *
 * Two things about THIS page's migration:
 *
 * 1. THE PAGE'S OWN SCROLL BOX IS PRESERVED, moved from an inline style onto
 *    the template's `className`. The card's own text says the only `maxHeight`
 *    in the three files is Dashboard.tsx:679 — that is WRONG, this file's root
 *    carried `maxHeight: 'calc(100vh - 200px)'` + `overflowY: 'auto'` as well
 *    (line 473 at the claim base). It is the whole reason this dashboard
 *    scrolls inside the admin content column instead of growing the admin
 *    page, so dropping it silently would have been a behaviour change. The
 *    200px is tied to AdminUI's header + tab chrome; whether it should stay a
 *    magic number is a question for the developer, not this card.
 *
 * 2. The heading level changes h2 -> h1 (PageHeader renders a real `<h1>` and
 *    the level is not a prop), so this page now has two `<h1>`s: AdminUI.tsx
 *    already renders one. Reported as an open question.
 *
 * TODO: no visual confirmation in this pass; the stories exist for the
 * developer's both-theme pass.
 * ------------------------------------------------------------------------- */

/**
 * KPI tile accent tones — the design system's semantic colour vocabulary,
 * replacing the raw `color` string the tiles used to take and concatenate into
 * `${color}15` for the icon chip. That made the accent theme-blind; these
 * follow the theme. It IS a colour change (see the card report).
 */
const STAT_TONE = {
    primary: 'bg-primary/10 text-primary',
    secondary: 'bg-secondary/10 text-secondary',
    tertiary: 'bg-tertiary/10 text-tertiary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
} as const;

type StatTone = keyof typeof STAT_TONE;

/** Left accent border per subsystem status, on the DS status tokens. */
const HEALTH_ACCENT: Record<SubsystemHealth['status'], string> = {
    healthy: 'border-l-success',
    degraded: 'border-l-warning',
    unhealthy: 'border-l-error',
};

const RANGE_OPTIONS = [
    { value: '1h', label: '1h' },
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
];

type DateRange = '1h' | '24h' | '7d' | '30d';

interface QueueStats {
    waiting: number;
    active: number;
    failed: number;
}

interface SubsystemHealth {
    status: 'healthy' | 'unhealthy' | 'degraded';
    latencyMs?: number;
    error?: string;
}

interface LiveMetrics {
    activeUsers: number;
    processingFiles: number;
    totalKnowledgeBases: number;
    totalFiles: number;
    totalStorageBytes: number;
    totalUsers: number;
    totalMessages: number;
    totalMessagesApi: number;
    messages24h: number;
    messages24hApi: number;
    queueStats: {
        'rag-quick': QueueStats;
        'rag-heavy': QueueStats;
        'rag-batch': QueueStats;
    };
    resourceUsage: {
        nodeHeapUsedMB: number;
        systemMemoryUsedPercent: number;
        cpuLoadAvg1m: number;
        cpuLoadAvg5m: number;
        cpuLoadAvg15m: number;
        cpuCount: number;
    };
    subsystemHealth: {
        mainDb: SubsystemHealth;
        vectorDb: SubsystemHealth;
        redis: SubsystemHealth;
        storage: SubsystemHealth;
    };
    timestamp: string;
}

interface HistoricalData {
    metric: string;
    data: { timestamp: string; value: number }[];
}

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatTime = (isoString: string): string => {
    return new Date(isoString).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit'
    });
};

// Hoisted to module scope: defining a component type inside the dashboard's
// render would create a new type each render and reset its state.
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; color: string }[]; label?: string }) => {
    if (active && payload && payload.length) {
        return (
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-on-surface shadow-overlay">
                <div className="mb-1 font-medium">{label}</div>
                {payload.map((entry, index: number) => (
                    /* SURVIVING INLINE STYLE: the recharts series colour is a
                     * runtime value off the chart payload. */
                    <div key={index} className="text-sm" style={{ color: entry.color }}>
                        {entry.value}
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

/**
 * The stat tiles keep their mount animation, so the animated element has to BE
 * the DS Card rather than a wrapper around it. `motion.create` is
 * framer-motion's documented way to animate a third-party component (it needs
 * `className`, `style` and a forwarded ref, all of which `Card` provides), and
 * it avoids the extra `<div>` a `motion.div` wrapper would add inside the
 * template's `stats` Grid.
 */
const MotionCard = motion.create(Card);

/**
 * KPI tile for the template's `stats` slot.
 *
 * It stays a LOCAL composition of `Card`: the design system ships no stat/KPI
 * component even though `DashboardLayout`'s `stats` prop is documented as "KPI
 * tiles". Reported as a DS gap — Dashboard.tsx has the un-animated twin, and
 * promoting the two into one shared local primitive would be inventing the
 * component the design system is missing.
 */
const StatCard = ({ title, value, subtitle, icon: Icon, tone }: {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ElementType;
    tone: StatTone;
}) => (
    <MotionCard
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-5"
    >
        <div className="flex items-start justify-between gap-2">
            <div>
                <div className="mb-2 text-sm text-on-surface-variant">{title}</div>
                <div className="font-stat-lg text-stat-lg text-on-surface">{value}</div>
                {subtitle && (
                    <div className="mt-1 text-xs text-on-surface-variant">{subtitle}</div>
                )}
            </div>
            <div className={cn('rounded-lg p-3', STAT_TONE[tone])}>
                <Icon size={22} />
            </div>
        </div>
    </MotionCard>
);

const QueueCard = ({ name, stats }: { name: string; stats: QueueStats }) => (
    <Card className="p-4">
        <div className="mb-3 text-sm font-medium text-on-surface">{name}</div>
        <div className="flex gap-4 text-sm">
            <div className="text-center">
                <div className="font-semibold text-warning">{stats.waiting}</div>
                <div className="text-xs text-on-surface-variant">Wartend</div>
            </div>
            <div className="text-center">
                <div className="font-semibold text-primary">{stats.active}</div>
                <div className="text-xs text-on-surface-variant">Aktiv</div>
            </div>
            <div className="text-center">
                <div className="font-semibold text-error">{stats.failed}</div>
                <div className="text-xs text-on-surface-variant">Fehler</div>
            </div>
        </div>
    </Card>
);

const HealthIndicator = ({ name, health }: { name: string; health: SubsystemHealth }) => {
    const statusIcon = {
        healthy: <CheckCircle size={18} className="text-success" />,
        degraded: <AlertTriangle size={18} className="text-warning" />,
        unhealthy: <AlertCircle size={18} className="text-error" />,
    }[health.status];

    return (
        <Card className={cn('flex items-center justify-between gap-2 border-l-4 p-4', HEALTH_ACCENT[health.status])}>
            <div className="flex items-center gap-2">
                {statusIcon}
                <span className="font-medium">{name}</span>
            </div>
            <div className="text-sm text-on-surface-variant">
                {health.latencyMs !== undefined && `${health.latencyMs}ms`}
                {health.error && <span className="text-error"> - {health.error}</span>}
            </div>
        </Card>
    );
};

/**
 * Utilisation bar. `barClassName` replaced the old `color: string` prop: the
 * three call sites passed `var(--accent-primary)`, `var(--success-text)` and a
 * raw `#6a1b9a`, none of which is a design-system token. The track uses the
 * DS's own `--color-chart-track`.
 *
 * The design system ships no progress/meter component, so this stays a local
 * two-div composition — reported as a DS gap rather than worked around with a
 * new shared primitive.
 */
const GaugeBar = ({ value, max, label, barClassName }: {
    value: number;
    max: number;
    label: string;
    barClassName: string;
}) => {
    const percentage = Math.min((value / max) * 100, 100);
    return (
        <div className="mb-4">
            <div className="mb-2 flex justify-between">
                <span className="text-sm text-on-surface-variant">{label}</span>
                <span className="text-sm font-medium">{value.toFixed(1)}{max === 100 ? '%' : ''}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-chart-track">
                {/* SURVIVING INLINE STYLE: the fill width is the measured
                  * value, so it cannot be a utility class. */}
                <div
                    className={cn('h-full rounded-full transition-[width] duration-300 ease-out', barClassName)}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
};

/**
 * Chart panel. Same composition as Dashboard.tsx's: `CardHeader`'s `flex-col`
 * is flipped to `flex-row` through tailwind-merge, and the heading stays an
 * `<h3>` (CardTitle is a `div` at 24px; these titles were 16px/500). `m-0`
 * neutralises index.css's `@layer base { h3 { margin: revert } }`.
 */
const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Card>
        <CardHeader>
            <h3 className="m-0 text-base font-medium text-on-surface">{title}</h3>
        </CardHeader>
        <CardContent>{children}</CardContent>
    </Card>
);

/** Section heading above a grid that is not itself a Card. */
const SectionHeading = ({ children }: { children: React.ReactNode }) => (
    <h3 className="m-0 text-base font-medium text-on-surface-variant">{children}</h3>
);

/** Centred empty state inside a fixed-height chart box. */
const ChartEmpty = ({ children }: { children: React.ReactNode }) => (
    <div className="flex h-full items-center justify-center text-on-surface-variant">
        {children}
    </div>
);

export default function SystemHealthDashboard() {
    const { t } = useTheme();
    const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
    const [historicalData, setHistoricalData] = useState<{
        activeUsers: HistoricalData | null;
        storage: HistoricalData | null;
        totalFiles: HistoricalData | null;
        queueFailed: HistoricalData | null;
    }>({
        activeUsers: null,
        storage: null,
        totalFiles: null,
        queueFailed: null
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [dateRange, setDateRange] = useState<DateRange>('24h');
    // The DS Checkbox is a Radix <button role="checkbox">, which IS a labelable
    // element per HTML 4.10.4, so `Label htmlFor` + `Checkbox id` is a real
    // label/control pair. React generates the id so two mounts cannot collide.
    const autoRefreshId = useId();
    const [aiHealth, setAiHealth] = useState<{
        status: 'idle' | 'testing' | 'healthy' | 'unhealthy';
        latencyMs?: number;
        error?: string;
        providerName?: string;
    }>({ status: 'idle' });

    const checkAiHealth = useCallback(async () => {
        setAiHealth({ status: 'testing' });
        try {
            const res = await axios.post(`${API_BASE_URL}/api/system-health/ai-check`);
            const data = res.data;
            setAiHealth({
                status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
                latencyMs: data.latencyMs,
                error: data.error,
                providerName: data.providerName,
            });
        } catch {
            setAiHealth({ status: 'unhealthy', error: 'Prüfung fehlgeschlagen' });
        }
    }, []);

    const getDateRange = useCallback(() => {
        const to = new Date();
        let from: Date;
        switch (dateRange) {
            case '1h': from = new Date(to.getTime() - 60 * 60 * 1000); break;
            case '24h': from = new Date(to.getTime() - 24 * 60 * 60 * 1000); break;
            case '7d': from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000); break;
            case '30d': from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000); break;
        }
        return { from: from.toISOString(), to: to.toISOString() };
    }, [dateRange]);

    // Pure loaders: fetch and RETURN data, no state writes. Effects apply the
    // results inside async callbacks (react.dev fetch-then-set pattern), so no
    // setState happens synchronously within an effect body.
    const loadMetrics = useCallback(async (): Promise<LiveMetrics> => {
        const response = await axios.get(`${API_BASE_URL}/api/system-health/live`);
        return response.data;
    }, []);

    const loadHistoricalData = useCallback(async () => {
        const { from, to } = getDateRange();
        const metricsToFetch = ['active_users', 'storage_bytes', 'total_files', 'queue_failed'];

        const results = await Promise.all(
            metricsToFetch.map(metric =>
                axios.get(`${API_BASE_URL}/api/system-health/history`, {
                    params: { metric, from, to }
                }).then(res => res.data as HistoricalData)
            )
        );

        return {
            activeUsers: results[0],
            storage: results[1],
            totalFiles: results[2],
            queueFailed: results[3]
        };
    }, [getDateRange]);

    // State-applying wrappers for event handlers and interval callbacks.
    const fetchMetrics = useCallback(async () => {
        try {
            const data = await loadMetrics();
            setMetrics(data);
            setLastUpdated(new Date());
            setError(null);
        } catch (err: unknown) {
            console.error('Failed to fetch metrics:', err);
            setError(getApiErrorMessage(err, 'Fehler beim Laden der Metriken'));
        }
    }, [loadMetrics]);

    const fetchHistoricalData = useCallback(async () => {
        try {
            setHistoricalData(await loadHistoricalData());
        } catch (err: unknown) {
            console.error('Failed to fetch historical data:', err);
            setError(getApiErrorMessage(err, t('historicalDataError')));
        }
    }, [loadHistoricalData, t]);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        await Promise.all([fetchMetrics(), fetchHistoricalData()]);
        setLoading(false);
    }, [fetchMetrics, fetchHistoricalData]);

    // Initial load + refetch when the date range changes (loadHistoricalData's
    // identity tracks dateRange via getDateRange). All state writes happen in
    // async callbacks, never synchronously in the effect body.
    useEffect(() => {
        let cancelled = false;

        const metricsDone = loadMetrics()
            .then(data => {
                if (cancelled) return;
                setMetrics(data);
                setLastUpdated(new Date());
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                console.error('Failed to fetch metrics:', err);
                setError(getApiErrorMessage(err, 'Fehler beim Laden der Metriken'));
            });

        const historicalDone = loadHistoricalData()
            .then(data => {
                if (!cancelled) setHistoricalData(data);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                console.error('Failed to fetch historical data:', err);
                setError(getApiErrorMessage(err, t('historicalDataError')));
            });

        Promise.allSettled([metricsDone, historicalDone]).then(() => {
            if (!cancelled) setLoading(false);
        });

        return () => { cancelled = true; };
    }, [loadMetrics, loadHistoricalData, t]);

    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(fetchMetrics, 10000); // 10 seconds
        return () => clearInterval(interval);
    }, [autoRefresh, fetchMetrics]);

    if (loading && !metrics) {
        return (
            <Stack
                direction="row"
                align="center"
                justify="center"
                gap="sm"
                className="h-[400px] text-on-surface-variant"
            >
                <Spinner label="Lade System-Health-Dashboard..." />
                <span aria-hidden="true">Lade System-Health-Dashboard...</span>
            </Stack>
        );
    }

    if (error && !metrics) {
        return (
            <Stack
                align="center"
                justify="center"
                gap="md"
                className="h-[400px] text-on-surface-variant"
            >
                <AlertCircle size={48} className="text-error" />
                <div>{error}</div>
                <Button variant="outline" onClick={fetchAll}>
                    Erneut versuchen
                </Button>
            </Stack>
        );
    }

    if (!metrics) return null;

    const formatChartData = (data: HistoricalData | null) => {
        if (!data) return [];
        return data.data.map(d => ({
            time: formatTime(d.timestamp),
            value: d.value
        }));
    };

    const formatChartDataDelta = (data: HistoricalData | null) => {
        if (!data || data.data.length < 2) return [];

        const deltaData = [];
        for (let i = 1; i < data.data.length; i++) {
            const current = data.data[i];
            const previous = data.data[i - 1];
            // Calculate difference, ensure non-negative (handle restarts/resets gracefully)
            const diff = Math.max(0, current.value - previous.value);

            deltaData.push({
                time: formatTime(current.timestamp),
                value: diff
            });
        }
        return deltaData;
    };

    return (
        <DashboardLayout
            /* Two separate concerns, both explained at the top of this file:
             * the page's own scroll box (preserved from the pre-migration
             * root), and index.css's h1-h6/p `margin: revert` counterweight,
             * which PageHeader's own heading and description walk into. */
            className="max-h-[calc(100vh-200px)] overflow-y-auto [&>header_h1]:m-0 [&>header_p]:m-0"
            title={
                <span className="inline-flex items-center gap-2">
                    <Activity size={24} aria-hidden="true" />
                    System Health
                </span>
            }
            description={lastUpdated ? (
                <span className="inline-flex items-center gap-1">
                    <Clock size={14} aria-hidden="true" />
                    Zuletzt aktualisiert: {lastUpdated.toLocaleTimeString('de-DE')}
                </span>
            ) : undefined}
            actions={
                <>
                    <div className="flex items-center gap-2">
                        {/* Checkbox, not Switch: a one-for-one replacement of
                          * the native checkbox that was here. Flagged as an
                          * open question — the value applies immediately,
                          * which is the case Switch exists for. */}
                        <Checkbox
                            id={autoRefreshId}
                            checked={autoRefresh}
                            onCheckedChange={(next) => setAutoRefresh(next === true)}
                        />
                        <Label htmlFor={autoRefreshId} className="cursor-pointer">
                            Auto-Refresh (10s)
                        </Label>
                    </div>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={fetchAll}
                        title="Aktualisieren"
                        aria-label="Aktualisieren"
                    >
                        {loading
                            ? <Spinner size="sm" label="Aktualisiere …" />
                            : <RefreshCw size={16} aria-hidden="true" />}
                    </Button>
                </>
            }
            stats={
                <>
                    <StatCard
                        title="Aktive Benutzer"
                        value={metrics.activeUsers}
                        subtitle="Letzte 15 Min"
                        icon={Users}
                        tone="primary"
                    />
                    <StatCard
                        title="Dateien in Verarbeitung"
                        value={metrics.processingFiles}
                        icon={FileText}
                        tone="warning"
                    />
                    <StatCard
                        title="Knowledge Bases"
                        value={metrics.totalKnowledgeBases}
                        icon={Database}
                        tone="success"
                    />
                    <StatCard
                        title="Dateien gesamt"
                        value={metrics.totalFiles}
                        icon={FileText}
                        tone="tertiary"
                    />
                    <StatCard
                        title="Speicher"
                        value={formatBytes(metrics.totalStorageBytes)}
                        icon={HardDrive}
                        tone="secondary"
                    />
                    <StatCard
                        title="Benutzer gesamt"
                        value={metrics.totalUsers}
                        icon={Users}
                        tone="info"
                    />
                    <StatCard
                        title="Nachrichten gesamt"
                        value={metrics.totalMessages}
                        subtitle={`davon ${metrics.totalMessagesApi} über API`}
                        icon={MessageSquare}
                        tone="primary"
                    />
                    <StatCard
                        title="Nachrichten (24 h)"
                        value={metrics.messages24h}
                        subtitle={`davon ${metrics.messages24hApi} über API`}
                        icon={MessageSquare}
                        tone="info"
                    />
                </>
            }
        >
            {/* Queue Stats */}
            <Stack gap="md">
                <SectionHeading>Job-Warteschlangen</SectionHeading>
                <Grid cols={3}>
                    <QueueCard name="rag-quick" stats={metrics.queueStats['rag-quick']} />
                    <QueueCard name="rag-heavy" stats={metrics.queueStats['rag-heavy']} />
                    <QueueCard name="rag-batch" stats={metrics.queueStats['rag-batch']} />
                </Grid>
            </Stack>

            {/* Subsystem Health + Resources */}
            <Grid cols={2}>
                <Stack gap="md">
                    <SectionHeading>Subsystem-Status</SectionHeading>
                    <Stack gap="sm">
                        <HealthIndicator name="Haupt-Datenbank" health={metrics.subsystemHealth.mainDb} />
                        <HealthIndicator name="Vektor-Datenbank" health={metrics.subsystemHealth.vectorDb} />
                        <HealthIndicator name="Redis" health={metrics.subsystemHealth.redis} />
                        <HealthIndicator name="Speicher" health={metrics.subsystemHealth.storage} />

                        {/* AI Provider Health — manual check. Not a
                          * HealthIndicator: its status vocabulary is
                          * idle/testing/healthy/unhealthy and it owns a
                          * button, so it stays its own row. */}
                        <Card
                            className={cn(
                                'flex items-center justify-between gap-2 border-l-4 p-4',
                                aiHealth.status === 'healthy' ? 'border-l-success'
                                    : aiHealth.status === 'unhealthy' ? 'border-l-error'
                                        : 'border-l-outline-variant',
                            )}
                        >
                            <div className="flex items-center gap-2">
                                {aiHealth.status === 'testing' && <Spinner size="default" label="Teste …" />}
                                {aiHealth.status === 'healthy' && <CheckCircle size={18} className="text-success" />}
                                {aiHealth.status === 'unhealthy' && <AlertCircle size={18} className="text-error" />}
                                {aiHealth.status === 'idle' && <Cpu size={18} className="text-on-surface-variant" />}
                                <span className="font-medium">
                                    {aiHealth.providerName ? `KI-Anbieter (${aiHealth.providerName})` : 'KI-Anbieter'}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                                {aiHealth.status === 'idle' && (
                                    <span className="text-on-surface-variant">Nicht getestet</span>
                                )}
                                {aiHealth.status === 'testing' && (
                                    <span className="text-on-surface-variant">Teste...</span>
                                )}
                                {aiHealth.status === 'healthy' && aiHealth.latencyMs !== undefined && (
                                    <span className="text-on-surface-variant">{aiHealth.latencyMs}ms</span>
                                )}
                                {aiHealth.status === 'unhealthy' && aiHealth.error && (
                                    <span className="text-error">{aiHealth.error}</span>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={checkAiHealth}
                                    disabled={aiHealth.status === 'testing'}
                                >
                                    Prüfen
                                </Button>
                            </div>
                        </Card>
                    </Stack>
                </Stack>

                {/* Resource Usage */}
                <Card>
                    <CardHeader>
                        <h3 className="m-0 flex items-center gap-2 text-base font-medium text-on-surface">
                            <Server size={18} aria-hidden="true" />
                            Ressourcenverbrauch
                        </h3>
                    </CardHeader>
                    <CardContent>
                        <GaugeBar
                            value={metrics.resourceUsage.cpuLoadAvg1m}
                            max={metrics.resourceUsage.cpuCount || 4}
                            label="CPU Load (1m)"
                            barClassName="bg-primary"
                        />
                        <GaugeBar
                            value={metrics.resourceUsage.systemMemoryUsedPercent}
                            max={100}
                            label="Systemspeicher"
                            barClassName="bg-success"
                        />
                        <GaugeBar
                            value={metrics.resourceUsage.nodeHeapUsedMB}
                            max={1024}
                            label={`Node Heap (${metrics.resourceUsage.nodeHeapUsedMB} MB)`}
                            barClassName="bg-tertiary"
                        />
                    </CardContent>
                </Card>
            </Grid>

            {/* Historical Charts */}
            <Stack gap="md">
                <div className="flex items-center justify-between gap-2">
                    <SectionHeading>Historische Daten</SectionHeading>
                    {/* Replaces four raw <button>s that already looked like a
                      * segmented control. `SegmentedControl` is the DS control
                      * for exactly this, and its docstring names the
                      * chart-range switch as the case. It renders its own raw
                      * buttons INSIDE the design system, where the
                      * raw-elements rule does not apply. */}
                    <SegmentedControl
                        aria-label="Zeitraum"
                        options={RANGE_OPTIONS}
                        value={dateRange}
                        onValueChange={(next) => {
                            if (next === dateRange) return;
                            // Show the refresh spinner while the
                            // range-change effect refetches.
                            setLoading(true);
                            setDateRange(next as DateRange);
                        }}
                    />
                </div>

                <Grid cols={2}>
                    <ChartCard title="Aktive Benutzer">
                        <div className="h-[200px]">
                            {formatChartData(historicalData.activeUsers).length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={formatChartData(historicalData.activeUsers)}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis dataKey="time" tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }} />
                                        <YAxis tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Area type="monotone" dataKey="value" stroke="#165a97" fill="#165a9740" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine Daten vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>

                    <ChartCard title="Speicherverbrauch">
                        <div className="h-[200px]">
                            {formatChartData(historicalData.storage).length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={formatChartData(historicalData.storage).map(d => ({
                                        ...d,
                                        value: d.value / (1024 * 1024 * 1024) // Convert to GB
                                    }))}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis dataKey="time" tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }} />
                                        <YAxis tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(1)} GB`} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Area type="monotone" dataKey="value" stroke="#2d8f4e" fill="#2d8f4e40" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine Daten vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>

                    <ChartCard title="Dateien verarbeitet (pro Intervall)">
                        <div className="h-[200px]">
                            {formatChartDataDelta(historicalData.totalFiles).length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={formatChartDataDelta(historicalData.totalFiles)}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis dataKey="time" tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }} />
                                        <YAxis tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar dataKey="value" fill="#6a1b9a" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine Daten vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>

                    <ChartCard title="Fehler in Warteschlangen">
                        <div className="h-[200px]">
                            {formatChartData(historicalData.queueFailed).length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={formatChartData(historicalData.queueFailed)}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis dataKey="time" tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }} />
                                        <YAxis tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 11 }} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Line type="monotone" dataKey="value" stroke="#c0392b" strokeWidth={2} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine Daten vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>
                </Grid>
            </Stack>

            {/* SURVIVING <style> BLOCK — deliberately NOT deleted, even though
              * nothing in this file uses `.spin` any more.
              *
              * `.spin` is NOT defined in src/index.css (only `@keyframes spin`
              * and `.animate-spin` are), yet ~17 components across the app
              * render `className="spin"`. The class exists only because three
              * components inject it globally through a <style> element, and
              * this is one of them. Removing it is an app-wide CSS change with
              * a blast radius this card cannot verify, so it needs its own
              * card together with the decision to standardise on
              * `.animate-spin`.
              * TODO: not verified which mounted component each of those 17
              * call sites currently depends on. */}
            <style>{`
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </DashboardLayout>
    );
}
