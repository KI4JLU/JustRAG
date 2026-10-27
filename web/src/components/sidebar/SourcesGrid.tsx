import React, { memo, useMemo, useState, useCallback } from 'react';
import { Search, Globe, Rss, Upload, Type, GraduationCap, BookOpen, Loader2, X, ArrowRight, GitBranch, Telescope, ChevronDown, Check } from 'lucide-react';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import './SourcesGrid.css';

export type SourceType = 'websearch' | 'crawl' | 'research' | 'rss' | 'upload' | 'text' | 'academic' | 'confluence' | 'gitrepo';

interface WebSearchProps {
    toolInput: string;
    setToolInput: (val: string) => void;
    toolLoading: boolean;
    onSubmit: (tabOverride?: 'websearch' | 'crawl' | 'research' | 'rss') => void;
    setToolTab: (tab: 'websearch' | 'crawl' | 'research' | 'rss') => void;
    webResearchRunning: boolean;
    webResearchStatus: string | null;
    webResearchProgress: { step: number; total: number };
    onCancelWebResearch: () => void;
    hasResults?: boolean;
    onOpenWorkspace?: () => void;
}

interface SourcesGridProps {
    onSelect: (type: SourceType) => void;
    webSearch?: WebSearchProps;
}

type SearchMode = 'fast' | 'deep';

const gridItems: { type: SourceType; icon: typeof Search; labelKey: string }[] = [
    { type: 'crawl', icon: Globe, labelKey: 'crawl' },
    { type: 'rss', icon: Rss, labelKey: 'rss' },
    { type: 'upload', icon: Upload, labelKey: 'uploadFile' },
    { type: 'text', icon: Type, labelKey: 'insertText' },
    { type: 'confluence', icon: BookOpen, labelKey: 'confluence' },
    { type: 'gitrepo', icon: GitBranch, labelKey: 'gitRepo' },
    { type: 'academic', icon: GraduationCap, labelKey: 'justFind' },
];

const SourcesGridComp: React.FC<SourcesGridProps> = ({ onSelect, webSearch }) => {
    const { t } = useTheme();
    const { siteConfigs } = useAuth();
    const [mode, setMode] = useState<SearchMode>('fast');

    const items = useMemo(() => {
        const confluenceEnabled = siteConfigs?.confluence_enabled === 'true';
        const gitRepoEnabled = siteConfigs?.git_repo_enabled === 'true';
        return gridItems.filter(i => {
            if (i.type === 'confluence' && !confluenceEnabled) return false;
            // 'academic' öffnete die Academic-Research-Ansicht; die ist seit
            // dem 22.09.2026 nicht erreichbar (KbViewType = 'chat'), also
            // fehlt die Kachel — unabhängig von academic_search_enabled.
            if (i.type === 'academic') return false;
            if (i.type === 'gitrepo' && !gitRepoEnabled) return false;
            return true;
        });
    }, [siteConfigs?.confluence_enabled, siteConfigs?.git_repo_enabled]);

    const webSearchEnabled = siteConfigs?.web_search_enabled === 'true';

    const handleModeChange = useCallback((m: SearchMode) => {
        setMode(m);
        webSearch?.setToolTab(m === 'fast' ? 'websearch' : 'research');
    }, [webSearch]);

    const handleSubmit = useCallback(() => {
        if (!webSearch || !webSearch.toolInput.trim()) return;
        const tab = mode === 'fast' ? 'websearch' : 'research';
        webSearch.setToolTab(tab);
        webSearch.onSubmit(tab);
    }, [mode, webSearch]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && webSearch?.toolInput.trim() && !webSearch.toolLoading && !webSearch.webResearchRunning) {
            handleSubmit();
        }
    }, [webSearch, handleSubmit]);

    return (
        <div className="sources-grid">
            {webSearchEnabled && webSearch && (
                <>
                    <div className="sources-grid__search-box">
                        <div className="sources-grid__search-header">
                            <span className="sources-grid__search-label">
                                <Search size={13} aria-hidden="true" />
                                {t('websearch')}
                            </span>
                            {/* The mode: a DS dropdown with a line of explanation per mode. */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    {/* eslint-disable-next-line design-system/no-raw-ui-elements -- the header's compact mode pill (26px), styled in SourcesGrid.css */}
                                    <button
                                        type="button"
                                        className="sources-grid__search-mode"
                                        disabled={webSearch.toolLoading || webSearch.webResearchRunning}
                                        aria-label={`${t('searchMode')}: ${mode === 'fast' ? t('websearchFast') : t('websearchDeep')}`}
                                    >
                                        {mode === 'fast' ? t('websearchFast') : t('websearchDeep')}
                                        <ChevronDown size={14} aria-hidden="true" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-72">
                                    {([
                                        ['fast', Search, 'websearchFastTitle', 'websearchFastHint'],
                                        ['deep', Telescope, 'websearchDeepTitle', 'websearchDeepHint'],
                                    ] as const).map(([value, Icon, title, hint]) => (
                                        <DropdownMenuItem
                                            key={value}
                                            onSelect={() => handleModeChange(value)}
                                            aria-checked={mode === value}
                                            role="menuitemradio"
                                            className="items-start"
                                        >
                                            <Icon aria-hidden="true" className="mt-0.5" />
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span className="font-medium">{t(title)}</span>
                                                <span className="text-xs text-on-surface-variant">{t(hint)}</span>
                                            </span>
                                            {mode === value && <Check aria-hidden="true" className="mt-0.5 text-primary" />}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <div className="sources-grid__search-input-row">
                            <input
                                type="text"
                                placeholder={mode === 'fast' ? t('enterSearchTerm') : t('enterTopic')}
                                value={webSearch.toolInput}
                                onChange={e => webSearch.setToolInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={webSearch.toolLoading || webSearch.webResearchRunning}
                                className="sources-grid__search-input"
                            />
                            {webSearch.toolLoading ? (
                                <Loader2 size={14} className="animate-spin sources-grid__search-spinner" />
                            ) : (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={handleSubmit}
                                            disabled={!webSearch.toolInput.trim() || webSearch.webResearchRunning}
                                            className="sources-grid__search-submit"
                                            aria-label={mode === 'fast' ? t('startWebsearch') : t('startResearch')}
                                        >
                                            <ArrowRight size={14} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{mode === 'fast' ? t('startWebsearch') : t('startResearch')}</TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                        {webSearch.hasResults && webSearch.onOpenWorkspace && (
                            <button
                                onClick={webSearch.onOpenWorkspace}
                                className="sources-grid__search-results-link"
                            >
                                {t('openWorkspace')}
                            </button>
                        )}
                        {/* A running research report belongs to this box: its status
                            line under the input, its progress a bar on the box's
                            bottom edge. */}
                        {(webSearch.webResearchRunning || webSearch.webResearchStatus) && (
                            <div className="sources-grid__research-progress">
                                <div className="sources-grid__research-track">
                                    <div
                                        className="sources-grid__research-fill"
                                        style={{ width: `${Math.max(5, (webSearch.webResearchProgress.step / (webSearch.webResearchProgress.total || 1)) * 100)}%` }}
                                    />
                                </div>
                                <div className="sources-grid__research-row">
                                    <span className="sources-grid__research-text">
                                        {webSearch.webResearchStatus}
                                        {webSearch.webResearchProgress.step > 0 && ` (${webSearch.webResearchProgress.step}/${webSearch.webResearchProgress.total})`}
                                    </span>
                                    {webSearch.webResearchRunning && (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button onClick={webSearch.onCancelWebResearch} className="sources-grid__research-cancel" aria-label={t('cancelResearch')}>
                                                    <X size={12} />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent>{t('cancelResearch')}</TooltipContent>
                                        </Tooltip>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            <div className="sources-grid__grid">
                {items.map(({ type, icon: Icon, labelKey }) => (
                    <button
                        key={type}
                        className="sources-grid__item"
                        onClick={() => onSelect(type)}
                    >
                        <Icon size={18} aria-hidden="true" />
                        <span className="sources-grid__label">{t(labelKey)}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export const SourcesGrid = memo(SourcesGridComp);
