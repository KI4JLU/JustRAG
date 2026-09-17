import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { getApiErrorMessage } from './utils/apiError';
import {
    BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
    FileText, MessageSquare, Sparkles, TrendingUp,
    RefreshCw, Download, ThumbsUp
} from 'lucide-react';
import {
    Button, Card, CardContent, CardHeader, DashboardLayout, Grid, Select,
    SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner, Stack, cn,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from './api';

/* ---------------------------------------------------------------------------
 * Shell: the design system's `DashboardLayout` template (card KI-714, Stage 4b
 * of the DS migration — Stage 4a did `AuthLayout`).
 *
 * The template's real slot API, read off the COMPILED source in the installed
 * package (@ki4jlu/design-system 0.23.1, dist/index.js — the package ships no
 * MDX for templates, so `dist/templates/dashboard-layout.d.ts` plus the
 * bundle are the only contract):
 *
 *   <Container className="flex flex-col gap-stack-lg py-gutter md:py-margin-page">
 *     {toolbar}                       <- rendered FIRST, above the heading
 *     <PageHeader title description actions />
 *     {stats && <Grid cols={4}>{stats}</Grid>}
 *     {children}
 *   </Container>
 *
 * so: `toolbar` sits ABOVE the title, `actions` is the right-hand side of the
 * header row, `stats` is force-wrapped in a 4-column responsive Grid, and
 * `children` is free-form. Vertical rhythm (`gap-stack-lg`) and the page
 * margins (`py-gutter md:py-margin-page`, `px-gutter md:px-margin-page` from
 * Container) are the template's — every inline style that used to produce them
 * is deleted rather than carried across.
 *
 * How it compares to `AuthLayout`'s two known gaps (asked for on the card):
 *   1. WIDTH IS REACHABLE here. AuthLayout puts `max-w-md` on an inner Stack
 *      that `className` cannot address; DashboardLayout's only width
 *      constraint is Container's own `max-w-(--max-width-container-max)`,
 *      which sits on the very element `className` is merged into (through
 *      cva's className slot + `cn`'s tailwind-merge), so a call site can
 *      override it. Not shared.
 *   2. THERE IS AN `<h1>`. AuthLayout's title goes through `CardTitle`, which
 *      renders a `div`; DashboardLayout's goes through `PageHeader`, which
 *      renders `<header>` + a real heading. Not shared. KI-714 reported two
 *      further findings from here and design-system v0.24.0 answered both
 *      (card KI-743): the heading level was FIXED at 1 and is now the optional
 *      `headingLevel` prop — used by the two NESTED admin dashboards, not by
 *      this page — and PageHeader's `h1`/`p` carried no margin utility, which
 *      collided with index.css's `@layer base { h1 { margin: revert } }`
 *      counterweight; they now carry `m-0` inside the component, so the
 *      `[&>header_h1]:m-0 [&>header_p]:m-0` that used to be repeated on all
 *      three call sites is gone. The stories' CSSOM oracles still assert the
 *      computed 0px, so the guarantee stayed pinned when it moved.
 *
 * `<main>` is kept as a wrapper: the template renders a plain `div`, and this
 * page's root used to be the `<main>` landmark.
 * TODO: no visual confirmation in this pass — the stories exist so the
 * developer can do the both-theme pass cheaply.
 * ------------------------------------------------------------------------- */

/**
 * Categorical chart palette. Deliberately NOT migrated to tokens in this card:
 * the design system ships only `--color-chart-1..4` plus `--color-chart-track`
 * (dist/tokens.css), and the pie charts below need eight distinguishable hues.
 * These eight are also theme-BLIND, which is a real dark-mode defect — raised
 * in the card report as needing a DS decision (extend the chart ramp) and its
 * own card, not a silent eight-way remap here.
 */
const COLORS = ['#165a97', '#2d8f4e', '#cc8400', '#c0392b', '#6a1b9a', '#d84315', '#00838f', '#5c6bc0'];

/**
 * KPI tile accent tones. The pre-migration tiles took a raw hex `color` and
 * built their icon chip from it by string concatenation (`${color}15`), so the
 * accent was theme-blind and unreachable for the token pipeline. The six tones
 * here are the design system's own semantic colour vocabulary, so the tiles
 * now follow the theme. This IS a colour change (see the report).
 */
const STAT_TONE = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    tertiary: 'bg-tertiary/10 text-tertiary',
} as const;

type StatTone = keyof typeof STAT_TONE;

const DATE_RANGES = [
    { value: '7d', label: 'Letzte 7 Tage' },
    { value: '30d', label: 'Letzte 30 Tage' },
    { value: '90d', label: 'Letzte 90 Tage' },
    { value: 'all', label: 'Alle Zeit' },
] as const;

type DateRange = (typeof DATE_RANGES)[number]['value'];

interface DashboardProps {
    kbId: string;
    kbName: string;
}

interface FileStats {
    byType: { type: string; count: number; totalSize: number }[];
    byStatus: { status: string; count: number }[];
    byOrigin: { origin: string; count: number }[];
    totalFiles: number;
    totalSize: number;
}

interface ActivityStats {
    filesOverTime: { date: string; count: number }[];
    chatsOverTime: { date: string; count: number }[];
    messagesOverTime: { date: string; count: number }[];
}

interface ChatStats {
    totalChats: number;
    totalMessages: number;
    messagesByRole: { role: string; count: number }[];
    avgMessagesPerChat: number;
}

interface GeneratedContentStats {
    byType: { type: string; count: number }[];
    totalGenerated: number;
    overTime: { date: string; count: number }[];
}

interface RetrievalQualityStats {
    feedbackStats: { feedback: string; count: number }[];
    scoreOverTime: { day: string; avgScore: number; messageCount: number }[];
    lowScoreQueries: { id: string; content: string; createdAt: string; avgScore: number }[];
}

interface DashboardData {
    files: FileStats;
    activity: ActivityStats;
    chats: ChatStats;
    generatedContent: GeneratedContentStats;
}

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};

/**
 * KPI tile for the template's `stats` slot.
 *
 * It stays a LOCAL composition of `Card`: the design system ships no stat/KPI
 * component, even though `DashboardLayout`'s `stats` prop is documented as
 * "KPI tiles". Reported as a DS gap rather than promoted to a shared local
 * component here (SystemHealthDashboard.tsx has the animated twin) — a new
 * shared primitive is a design-system decision, not a migration's.
 */
const StatCard = ({ title, value, subtitle, icon: Icon, tone }: {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ElementType;
    tone: StatTone;
}) => (
    <Card className="p-5">
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
    </Card>
);

/**
 * Chart panel. `CardHeader`'s own `flex-col` is flipped to `flex-row` through
 * tailwind-merge (same class group, last wins), which is how the export button
 * ends up on the title's baseline without a hand-built flex row.
 *
 * The heading stays an `<h3>` rather than becoming `CardTitle`: CardTitle is a
 * `div` at `text-headline-md` (24px), and these panel titles were 16px/500.
 * `m-0` neutralises index.css's `@layer base { h3 { margin: revert } }`.
 */
const ChartCard = ({ title, children, onExport }: {
    title: string;
    children: React.ReactNode;
    onExport?: () => void;
}) => (
    <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
            <h3 className="m-0 text-base font-medium text-on-surface">{title}</h3>
            {onExport && (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onExport}
                    title="Export"
                    aria-label="Export"
                >
                    <Download size={16} />
                </Button>
            )}
        </CardHeader>
        <CardContent>
            <div role="img" aria-label={title}>
                {children}
            </div>
        </CardContent>
    </Card>
);

interface TooltipEntry {
    name: string;
    value: number;
    color: string;
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) => {
    if (active && payload && payload.length) {
        return (
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-on-surface shadow-overlay">
                <div className="mb-1 font-medium">{label}</div>
                {payload.map((entry: TooltipEntry, index: number) => (
                    /* SURVIVING INLINE STYLE: the recharts series colour is a
                     * runtime value from the chart payload, not a design
                     * decision available at authoring time. */
                    <div key={index} className="text-sm" style={{ color: entry.color }}>
                        {entry.name}: {entry.value}
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

/** Centred empty state inside a fixed-height chart box. */
const ChartEmpty = ({ children }: { children: React.ReactNode }) => (
    <div className="flex h-full items-center justify-center text-on-surface-variant">
        {children}
    </div>
);

export default function Dashboard({ kbId, kbName }: DashboardProps) {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [qualityData, setQualityData] = useState<RetrievalQualityStats | null>(null);

    // Filter state
    const [dateRange, setDateRange] = useState<DateRange>('30d');

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            const now = new Date();
            let from;
            switch (dateRange) {
                case '7d': from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(); break;
                case '30d': from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(); break;
                case '90d': from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(); break;
            }
            if (from) params.set('from', from);

            const response = await axios.get(`${API_BASE_URL}/api/kb/${kbId}/analytics?${params}`);
            setData(response.data);

            // Also fetch retrieval quality data
            try {
                const qualityResponse = await axios.get(`${API_BASE_URL}/api/kb/${kbId}/analytics/retrieval-quality?${params}`);
                setQualityData(qualityResponse.data);
            } catch {
                // Retrieval quality is optional — don't fail the whole dashboard
                setQualityData(null);
            }
        } catch (err: unknown) {
            console.error('Failed to fetch dashboard data:', err);
            setError(getApiErrorMessage(err, 'Failed to load dashboard data'));
        } finally {
            setLoading(false);
        }
    }, [kbId, dateRange]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    if (loading) {
        return (
            <Stack
                direction="row"
                align="center"
                justify="center"
                gap="sm"
                className="h-[400px] text-on-surface-variant"
            >
                {/* The DS Spinner carries role="status" and its `label` is the
                  * sr-only announcement, so the visible copy is aria-hidden —
                  * otherwise the same sentence is announced twice. Replaces
                  * `<RefreshCw className="spin">`, whose `.spin` class is not
                  * defined in index.css at all (only `@keyframes spin` and
                  * `.animate-spin` are) — it only ever animated because some
                  * OTHER mounted component injected a global <style> block. */}
                <Spinner label="Lade Dashboard..." />
                <span aria-hidden="true">Lade Dashboard...</span>
            </Stack>
        );
    }

    if (error) {
        return (
            <Stack
                align="center"
                justify="center"
                gap="md"
                className="h-[400px] text-on-surface-variant"
            >
                <div>{error}</div>
                <Button variant="outline" onClick={fetchData}>
                    Erneut versuchen
                </Button>
            </Stack>
        );
    }

    if (!data) return null;

    // Fill in missing dates for activity timeline
    const allDates = new Set([
        ...data.activity.filesOverTime.map(f => f.date),
        ...data.activity.chatsOverTime.map(c => c.date),
        ...data.activity.messagesOverTime.map(m => m.date)
    ]);
    const sortedDates = Array.from(allDates).sort();
    const fullActivityData = sortedDates.map(date => {
        const file = data.activity.filesOverTime.find(f => f.date === date);
        const chat = data.activity.chatsOverTime.find(c => c.date === date);
        const msg = data.activity.messagesOverTime.find(m => m.date === date);
        return {
            date: formatDate(date),
            Dateien: file?.count || 0,
            Chats: chat?.count || 0,
            Nachrichten: msg?.count || 0
        };
    });

    return (
        <main>
            <DashboardLayout
                /* No margin workaround here any more: KI-714 reported the
                 * collision to the design system, and v0.24.0 puts `m-0` on
                 * PageHeader's own heading and description (card KI-743). No
                 * `headingLevel` either — unlike the two admin dashboards this
                 * page is not nested under another <h1>, so the template's
                 * default level 1 is correct. */
                title="Dashboard"
                description={kbName}
                actions={
                    <>
                        {/* Replaces a hand-built dropdown: a raw <button>
                          * trigger plus four raw <button> options in an
                          * absolutely positioned div, with no Escape, no arrow
                          * keys, no typeahead and no outside-click handling.
                          * The DS Select is a Radix listbox, so all four come
                          * for free — and the `showFilters` state that drove
                          * the old panel is gone with it.
                          * The leading Calendar icon is DROPPED: SelectTrigger
                          * styles its direct `<span>` child with
                          * `line-clamp-1` (display: -webkit-box), which would
                          * fight any wrapper that laid an icon out next to the
                          * value. */}
                        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
                            <SelectTrigger aria-label="Zeitraum" className="w-[190px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DATE_RANGES.map(range => (
                                    <SelectItem key={range.value} value={range.value}>
                                        {range.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Button
                            variant="outline"
                            size="icon"
                            onClick={fetchData}
                            title="Aktualisieren"
                            aria-label="Aktualisieren"
                        >
                            <RefreshCw size={16} />
                        </Button>
                    </>
                }
                stats={
                    <>
                        <StatCard
                            title="Dateien"
                            value={data.files.totalFiles}
                            subtitle={formatBytes(data.files.totalSize)}
                            icon={FileText}
                            tone="primary"
                        />
                        <StatCard
                            title="Chats"
                            value={data.chats.totalChats}
                            subtitle={`${data.chats.avgMessagesPerChat} Nachr./Chat`}
                            icon={MessageSquare}
                            tone="success"
                        />
                        <StatCard
                            title="Nachrichten"
                            value={data.chats.totalMessages}
                            icon={TrendingUp}
                            tone="warning"
                        />
                        <StatCard
                            title="Generiert"
                            value={data.generatedContent.totalGenerated}
                            icon={Sparkles}
                            tone="tertiary"
                        />
                        {qualityData && (
                            <StatCard
                                title="Feedback"
                                value={qualityData.feedbackStats.reduce((sum, f) => sum + (f.feedback !== 'none' ? f.count : 0), 0)}
                                subtitle={`${qualityData.feedbackStats.find(f => f.feedback === 'positive')?.count || 0} positiv`}
                                icon={ThumbsUp}
                                tone="success"
                            />
                        )}
                    </>
                }
            >
                {/* Charts. `Grid cols={2}` is the template vocabulary for what
                  * used to be `repeat(auto-fit, minmax(min(100%, 500px), 1fr))`
                  * — one column on mobile, two from `md` up. */}
                <Grid cols={2}>
                    {/* Activity Over Time */}
                    <ChartCard title="Aktivität im Zeitverlauf">
                        <div className="h-[280px]">
                            {fullActivityData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={fullActivityData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                                            tickLine={{ stroke: 'var(--color-outline-variant)' }}
                                        />
                                        <YAxis
                                            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                                            tickLine={{ stroke: 'var(--color-outline-variant)' }}
                                        />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Legend />
                                        <Area type="monotone" dataKey="Nachrichten" stackId="1" stroke="#cc8400" fill="#cc840040" />
                                        <Area type="monotone" dataKey="Chats" stackId="1" stroke="#2d8f4e" fill="#2d8f4e40" />
                                        <Area type="monotone" dataKey="Dateien" stackId="1" stroke="#165a97" fill="#165a9740" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine Aktivitätsdaten vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>

                    {/* Files by Type */}
                    <ChartCard title="Dateien nach Typ">
                        <div className="h-[280px]">
                            {data.files.byType.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={data.files.byType}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={2}
                                            dataKey="count"
                                            nameKey="type"
                                            label={({ name, percent }: { name?: string; percent?: number }) => `${(name ?? '').split('/').pop()} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                                            labelLine={false}
                                        >
                                            {data.files.byType.map((_, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine Dateien vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>

                    {/* Files by Status */}
                    <ChartCard title="Dateien nach Status">
                        <div className="h-[280px]">
                            {data.files.byStatus.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.files.byStatus} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis type="number" tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} />
                                        <YAxis
                                            type="category"
                                            dataKey="status"
                                            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                                            width={100}
                                        />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar dataKey="count" fill="#165a97" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine Statusdaten vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>

                    {/* Messages by Role */}
                    <ChartCard title="Nachrichten nach Rolle">
                        <div className="h-[280px]">
                            {data.chats.messagesByRole.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={data.chats.messagesByRole.map(r => ({
                                                ...r,
                                                role: r.role === 'user' ? 'Benutzer' : 'KI'
                                            }))}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={2}
                                            dataKey="count"
                                            nameKey="role"
                                            label={({ role, percent }) => `${role} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                                            labelLine={false}
                                        >
                                            <Cell fill="#165a97" />
                                            <Cell fill="#2d8f4e" />
                                        </Pie>
                                        <Tooltip content={<CustomTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine Nachrichten vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>

                    {/* Generated Content by Type */}
                    <ChartCard title="Generierte Inhalte nach Typ">
                        <div className="h-[280px]">
                            {data.generatedContent.byType.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.generatedContent.byType}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis
                                            dataKey="type"
                                            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                                        />
                                        <YAxis tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar dataKey="count" fill="#6a1b9a" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine generierten Inhalte vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>

                    {/* Files by Origin */}
                    <ChartCard title="Dateien nach Herkunft">
                        <div className="h-[280px]">
                            {data.files.byOrigin.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.files.byOrigin.map(o => ({
                                        ...o,
                                        origin: o.origin === 'upload' ? 'Upload' :
                                            o.origin === 'url' ? 'URL' :
                                                o.origin === 'crawl' ? 'Crawler' :
                                                    o.origin === 'research' ? 'Research' : o.origin
                                    }))}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis
                                            dataKey="origin"
                                            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                                        />
                                        <YAxis tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar dataKey="count" fill="#d84315" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <ChartEmpty>Keine Herkunftsdaten vorhanden</ChartEmpty>
                            )}
                        </div>
                    </ChartCard>

                    {/* Feedback Distribution */}
                    {qualityData && qualityData.feedbackStats.length > 0 && (
                        <ChartCard title="Feedback-Verteilung">
                            <div className="h-[280px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={qualityData.feedbackStats.map(f => ({
                                        ...f,
                                        feedback: f.feedback === 'positive' ? 'Positiv' :
                                            f.feedback === 'negative' ? 'Negativ' : 'Kein Feedback'
                                    }))}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis
                                            dataKey="feedback"
                                            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                                        />
                                        <YAxis tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                            {qualityData.feedbackStats.map((entry, index) => (
                                                <Cell
                                                    key={`feedback-${index}`}
                                                    fill={entry.feedback === 'positive' ? '#2d8f4e' :
                                                        entry.feedback === 'negative' ? '#c0392b' : '#6b7280'}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </ChartCard>
                    )}

                    {/* Retrieval Score Trend */}
                    {qualityData && qualityData.scoreOverTime.length > 0 && (
                        <ChartCard title="Retrieval-Score im Zeitverlauf">
                            <div className="h-[280px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={qualityData.scoreOverTime.map(s => ({
                                        ...s,
                                        day: formatDate(s.day),
                                        avgScore: Number((s.avgScore ?? 0).toFixed(3))
                                    }))}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant)" />
                                        <XAxis
                                            dataKey="day"
                                            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                                        />
                                        <YAxis
                                            tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                                            domain={[0, 1]}
                                        />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Area type="monotone" dataKey="avgScore" stroke="#165a97" fill="#165a9740" name="Ø Score" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </ChartCard>
                    )}

                    {/* Low-Score Queries.
                      * The <table> below is UNTOUCHED: Stage 5 (card KI-694)
                      * migrates it to `Table`/`TableLayout`, and this card is
                      * the outer page shell only — same discipline Stage 3b
                      * used for AdminEvalTab's tables. Its inline styles are
                      * therefore surviving styles BY INSTRUCTION.
                      *
                      * SURVIVING INLINE STYLE (mandated by the card): the
                      * `maxHeight: '280px'` scroll box is the only thing
                      * bounding this block's growth, and Stage 5 needs it
                      * alive so it can move it onto `Table`'s
                      * `containerClassName`. Do not delete it. */}
                    {qualityData && qualityData.lowScoreQueries.length > 0 && (
                        <ChartCard title="Niedrig bewertete Anfragen (letzte 7 Tage)">
                            <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <th style={{ textAlign: 'left', padding: '0.5rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Anfrage</th>
                                            <th style={{ textAlign: 'right', padding: '0.5rem', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>Ø Score</th>
                                            <th style={{ textAlign: 'right', padding: '0.5rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Datum</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {qualityData.lowScoreQueries.map(q => (
                                            <tr key={q.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '0.5rem', color: 'var(--text-primary)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {q.content.length > 80 ? q.content.substring(0, 80) + '...' : q.content}
                                                </td>
                                                <td style={{ padding: '0.5rem', textAlign: 'right', color: 'var(--color-error)', fontWeight: 500 }}>
                                                    {Number(q.avgScore).toFixed(3)}
                                                </td>
                                                <td style={{ padding: '0.5rem', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                                    {formatDate(q.createdAt)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </ChartCard>
                    )}
                </Grid>
            </DashboardLayout>
        </main>
    );
}
