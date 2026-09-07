import { useState, useEffect, useMemo } from 'react';
import { Save, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button, Input } from '@ki4jlu/design-system';
import { useReducedMotion, getMotionProps } from '../../hooks/useReducedMotion';
import { useTheme } from '../../contexts/ThemeContext';
import { CheckboxFieldRow, FieldRow, SelectFieldRow } from '../form/FieldRow';
import AdminAgentMetricsCard from './AdminAgentMetricsCard';
import AdminMCPSection from './AdminMCPSection';

interface AdminAgentTabProps {
    siteConfigs: Record<string, string>;
    setSiteConfigs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onSubmit: (e: React.FormEvent) => void;
}

const STORAGE_KEY = 'admin-agent-sections-open-v1';

const SECTION_CONFIGS = [
    { id: 'general', titleKey: 'agentSectionGeneral', i18nKeys: ['defaultTopK', 'scoreDropThreshold', 'contextWindowSize', 'chatAnswerTemperature'], settingKeys: ['default_top_k', 'score_drop_threshold', 'context_window_size', 'chat_answer_temperature'] },
    { id: 'hybrid', titleKey: 'agentSectionHybridSearch', i18nKeys: ['minSimilarityThreshold', 'mmrLambda', 'rrfWeightVector', 'rrfWeightBM25', 'bm25SimpleArmEnabled', 'bm25TieredBoostEnabled', 'hnswEfSearch', 'mrlTwoPassEnabled', 'queryInstruction', 'hyPESearchEnabled'], settingKeys: ['min_similarity_threshold', 'mmr_lambda', 'rrf_weight_vector', 'rrf_weight_bm25', 'bm25_simple_arm_enabled', 'bm25_tiered_boost_enabled', 'hnsw_ef_search', 'mrl_two_pass_enabled', 'query_instruction', 'hype_search_enabled'] },
    { id: 'reranker', titleKey: 'agentSectionReranker', i18nKeys: ['rerankBlendAlpha', 'rerankBlendAlphaLookup', 'rerankBlendAlphaEnumeration', 'rerankBlendAlphaComplexReasoning', 'rerankBlendAlphaEntity', 'hybridDynamicAlphaEnabled', 'hybridDynamicAlphaSensitivity', 'rerankUseChatTemplate', 'rerankInstruction'], settingKeys: ['rerank_blend_alpha', 'rerank_blend_alpha_lookup', 'rerank_blend_alpha_enumeration', 'rerank_blend_alpha_complex_reasoning', 'rerank_blend_alpha_entity', 'hybrid_dynamic_alpha_enabled', 'hybrid_dynamic_alpha_sensitivity', 'rerank_use_chat_template', 'rerank_instruction'] },
    { id: 'topn', titleKey: 'agentSectionPerRouteTopN', i18nKeys: ['topNLookup', 'topNEnumeration', 'topNComplexReasoning'], settingKeys: ['top_n_lookup', 'top_n_enumeration', 'top_n_complex_reasoning'] },
    { id: 'compression', titleKey: 'agentSectionCompression', i18nKeys: ['chatContextCompressionEnabled', 'chatContextCompressionMinChunks', 'chatContextCompressionThreshold', 'chatContextCompressionModel'], settingKeys: ['chat_context_compression_enabled', 'chat_context_compression_min_chunks', 'chat_context_compression_threshold', 'chat_context_compression_model'] },
    { id: 'queryEnh', titleKey: 'agentSectionQueryEnhancement', i18nKeys: ['autoSpellCorrect', 'stepBackEnabled', 'queryDecomposeEnabled', 'queryDecomposeModel', 'chatLongcontextEnabled', 'chatLongcontextMaxTokens', 'queryCacheEnabled', 'queryCacheSimilarityThreshold', 'queryCacheSimilarityThresholdLookup', 'queryCacheSimilarityThresholdEnumeration', 'queryCacheSimilarityThresholdComplexReasoning', 'queryCacheTtlHours'], settingKeys: ['auto_spell_correct', 'step_back_enabled', 'query_decompose_enabled', 'query_decompose_model', 'chat_longcontext_enabled', 'chat_longcontext_max_tokens', 'query_cache_enabled', 'query_cache_similarity_threshold', 'query_cache_similarity_threshold_lookup', 'query_cache_similarity_threshold_enumeration', 'query_cache_similarity_threshold_complex_reasoning', 'query_cache_ttl_hours'] },
    { id: 'crag', titleKey: 'agentSectionCragAdaptive', i18nKeys: ['cragEnabled', 'cragMinRelevantChunks', 'adaptiveRoutingEnabled'], settingKeys: ['crag_enabled', 'crag_min_relevant_chunks', 'adaptive_routing_enabled'] },
    { id: 'graph', titleKey: 'agentSectionGraph', i18nKeys: ['kgExtractionEnabled', 'chatGraphRoutingEnabled', 'chatGraphRoutingInjectChunks', 'chatGraphRoutingMaxChunks', 'chatGraphRoutingPathMode', 'chatGraphRoutingPPRDamping', 'chatGraphRoutingPPRMaxIter', 'chatGraphRoutingPPRTopEntities', 'chatGraphRoutingPathsMaxLen', 'chatGraphRoutingPathsMaxPaths'], settingKeys: ['kg_extraction_enabled', 'chat_graph_routing_enabled', 'chat_graph_routing_inject_chunks', 'chat_graph_routing_max_chunks', 'chat_graph_routing_path_mode', 'chat_graph_routing_ppr_damping', 'chat_graph_routing_ppr_max_iter', 'chat_graph_routing_ppr_top_entities', 'chat_graph_routing_paths_max_len', 'chat_graph_routing_paths_max_paths'] },
    { id: 'multistep', titleKey: 'agentSectionMultiStep', i18nKeys: ['chatKBRouterEnabled', 'chatKBRouterMinConfidence', 'chatTurnBudgetSeconds', 'chatTurnBudgetTokens', 'chatTurnBudgetToolCalls', 'chatAgenticEnabled', 'chatAgenticMaxHops', 'chatPlanExecuteEnabled', 'chatPlanExecuteMaxSubQueries', 'chatPlanExecuteMaxIterations', 'chatPlanExecuteTokenBudget', 'chatPlanExecuteToolAware', 'chatPlanExecuteDAGIterative', 'chatAnswerToolsEnabled', 'chatAnswerToolsMaxRounds', 'chatSupervisorEnabled', 'chatSupervisorMultiSpecialist', 'chatDriftEnabled', 'chatCommunitySearchEnabled'], settingKeys: ['chat_kb_router_enabled', 'chat_kb_router_min_confidence', 'chat_turn_budget_seconds', 'chat_turn_budget_tokens', 'chat_turn_budget_tool_calls', 'chat_agentic_enabled', 'chat_agentic_max_hops', 'chat_plan_execute_enabled', 'chat_plan_execute_max_sub_queries', 'chat_plan_execute_max_iterations', 'chat_plan_execute_token_budget', 'chat_plan_execute_tool_aware', 'chat_plan_execute_dag_iterative', 'chat_answer_tools_enabled', 'chat_answer_tools_max_rounds', 'chat_supervisor_enabled', 'chat_supervisor_multi_specialist', 'chat_drift_enabled', 'chat_community_search_enabled'] },
    { id: 'conversation', titleKey: 'agentSectionConversation', i18nKeys: ['chatAnswerHistoryEnabled', 'chatAnswerHistoryMessages', 'chatAnswerHistoryMaxChars', 'chatTransformFollowupEnabled'], settingKeys: ['chat_answer_history_enabled', 'chat_answer_history_messages', 'chat_answer_history_max_chars', 'chat_transform_followup_enabled'] },
    { id: 'corpusTable', titleKey: 'agentSectionCorpusTable', i18nKeys: ['chatCorpusTableEnabled', 'chatCorpusTableModel', 'chatCorpusTableMaxFiles', 'chatCorpusTableConcurrency', 'chatCorpusTableRouterLlmEnabled'], settingKeys: ['chat_corpus_table_enabled', 'chat_corpus_table_model', 'chat_corpus_table_max_files', 'chat_corpus_table_concurrency', 'chat_corpus_table_router_llm_enabled'] },
    { id: 'compare', titleKey: 'agentSectionCompare', i18nKeys: ['chatCompareEnabled', 'chatCompareModel', 'chatCompareMaxSections', 'chatCompareConcurrency', 'chatComparePeersPerSection', 'chatCompareAttachmentTtlHours', 'chatCompareMaxFileBytes'], settingKeys: ['chat_compare_enabled', 'chat_compare_model', 'chat_compare_max_sections', 'chat_compare_concurrency', 'chat_compare_peers_per_section', 'chat_compare_attachment_ttl_hours', 'chat_compare_max_file_bytes'] },
    { id: 'teams', titleKey: 'agentSectionTeams', i18nKeys: ['agentTeamRouterModel', 'agentsAllowPrivilegedTools'], settingKeys: ['agent_team_router_model', 'agents_allow_privileged_tools'] },
    { id: 'longmem', titleKey: 'agentSectionLongmem', i18nKeys: ['chatLongmemEnabled', 'chatLongmemMinSalience', 'chatLongmemRecallTopK', 'chatLongmemDecayDays', 'chatLongmemRecallSemantic', 'chatLongmemConflictResolution', 'chatLongmemConflictModel', 'chatLongmemConflictCandidates'], settingKeys: ['chat_longmem_enabled', 'chat_longmem_min_salience', 'chat_longmem_recall_top_k', 'chat_longmem_decay_days', 'chat_longmem_recall_semantic', 'chat_longmem_conflict_resolution', 'chat_longmem_conflict_model', 'chat_longmem_conflict_candidates'] },
    { id: 'validation', titleKey: 'agentSectionValidation', i18nKeys: ['factcheckInChat', 'citationValidationEnabled', 'citationValidationSemanticThreshold', 'chatFactualityGateEnabled', 'chatFactualityGateMaxRefines', 'chatSelfRAGEnabled', 'ragasSamplingEnabled', 'ragasSamplingRate'], settingKeys: ['factcheck_in_chat', 'citation_validation_enabled', 'citation_validation_semantic_threshold', 'chat_factuality_gate_enabled', 'chat_factuality_gate_max_refines', 'chat_self_rag_enabled', 'ragas_sampling_enabled', 'ragas_sampling_rate'] },
    { id: 'ingestion', titleKey: 'agentSectionIngestion', i18nKeys: ['doclingEnabled', 'doclingBaseUrl', 'describeImageEnabled', 'describeImageEnabledHelp', 'describeImageModel', 'describeImageModelHelp', 'contextualEnrichment', 'embeddingBatchSize', 'lateChunkingEnabled', 'lateChunkingMaxInputTokens', 'parentChildEnabled', 'parentChunkSize', 'childChunkSize', 'raptorEnabled', 'raptorMinChunks', 'raptorMaxLevels', 'raptorBranchingFactor', 'raptorClusteringAlgorithm', 'raptorLeidenResolution', 'hyPEEnabled', 'hyPEQuestionsPerChunk', 'hyPEModel'], settingKeys: ['docling_enabled', 'docling_base_url', 'describe_image_enabled', 'describe_image_model', 'contextual_enrichment', 'embedding_batch_size', 'late_chunking_enabled', 'late_chunking_max_input_tokens', 'parent_child_enabled', 'parent_chunk_size', 'child_chunk_size', 'raptor_enabled', 'raptor_min_chunks', 'raptor_max_levels', 'raptor_branching_factor', 'raptor_clustering_algorithm', 'raptor_leiden_resolution', 'hype_enabled', 'hype_questions_per_chunk', 'hype_model'] },
    { id: 'observability', titleKey: 'agentSectionObservability', i18nKeys: ['langfuseBaseUrl'], settingKeys: ['langfuse_base_url'] },
    { id: 'tools', titleKey: 'agentSectionTools', i18nKeys: ['chatCodeExecEnabled'], settingKeys: ['mcp_servers', 'chat_use_mcp_tools', 'chat_code_exec_enabled'] },
    { id: 'tabular', titleKey: 'agentSectionTabular', i18nKeys: ['chatTabularQueryEnabled', 'chatTabularSemanticColumnsEnabled', 'tabularSemanticMinAvgLen', 'tabularSemanticMinDistinctRatio', 'chatTabularChartsEnabled'], settingKeys: ['chat_tabular_query_enabled', 'chat_tabular_semantic_columns_enabled', 'tabular_semantic_min_avg_len', 'tabular_semantic_min_distinct_ratio', 'chat_tabular_charts_enabled'] },
    { id: 'dateAware', titleKey: 'agentSectionDateAware', i18nKeys: ['chatDateAwarenessEnabled', 'chatDateTimezone', 'chatDateToolsEnabled', 'chatDateToolsMaxResults', 'chatRecencyListingEnabled', 'chatRecencyListingNameMatchEnabled', 'chatRecencyListingWindowDays', 'chatRecencyListingMaxResults'], settingKeys: ['chat_date_awareness_enabled', 'chat_date_timezone', 'chat_date_tools_enabled', 'chat_date_tools_max_results', 'chat_recency_listing_enabled', 'chat_recency_listing_name_match_enabled', 'chat_recency_listing_window_days', 'chat_recency_listing_max_results'] },
] as const;
type SectionId = typeof SECTION_CONFIGS[number]['id'];

function Section({ title, open, onToggle, hidden, children }: { title: string; open: boolean; onToggle: () => void; hidden: boolean; children: React.ReactNode }) {
    if (hidden) return null;
    return (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
            {/* The header is a DISCLOSURE, so its state is `aria-expanded` and stays
              * `aria-expanded`. Deliberately NOT `aria-pressed`, which the ghost
              * variant also styles on: a control must not claim to be both a toggle
              * button and a disclosure, and a screen reader would announce both
              * "pressed" and "expanded". `data-state` is Radix's non-ARIA convention
              * for exactly this, carries no accessibility meaning, and is the hook the
              * DS ghost variant already keys on — so it supplies the open-state tint
              * without the semantic conflict.
              *
              * TODO: not yet visually confirmed (no browser in this pass). Two DS
              * constraints are knowingly accepted rather than overridden at the call
              * site, because `className` on a DS control is layout only:
              *   - the Button's own `rounded-action` radius, so its hover fill may show
              *     a corner notch against the section body below it;
              *   - the Button's `whitespace-nowrap`, so a long section title cannot wrap.
              * What this really wants is a DS variant for a full-width disclosure
              * header. Raised for the design system; do NOT patch it with
              * `rounded-none`/`whitespace-normal` here. */}
            <Button
                variant="ghost"
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                data-state={open ? 'open' : 'closed'}
                className="w-full justify-between text-left"
            >
                <span>{title}</span>
                {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </Button>
            {open && (
                <div style={{
                    padding: '1.25rem 1.25rem 1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.5rem',
                    background: 'var(--bg-primary)',
                    borderTop: '1px solid var(--border-color)',
                }}>
                    {children}
                </div>
            )}
        </div>
    );
}

export default function AdminAgentTab({ siteConfigs, setSiteConfigs, onSubmit }: AdminAgentTabProps) {
    const reducedMotion = useReducedMotion();
    const { t } = useTheme();

    const isCragEnabled = siteConfigs.crag_enabled === 'true' || siteConfigs.crag_enabled === '1';
    const isDoclingEnabled = siteConfigs.docling_enabled === 'true' || siteConfigs.docling_enabled === '1';
    const isDescribeImageEnabled = siteConfigs.describe_image_enabled === 'true' || siteConfigs.describe_image_enabled === '1';
    const isContextualEnrichmentEnabled = siteConfigs.contextual_enrichment !== 'false' && siteConfigs.contextual_enrichment !== '0';
    const isQueryCacheEnabled = siteConfigs.query_cache_enabled === 'true' || siteConfigs.query_cache_enabled === '1';
    const isTabularSemanticEnabled = siteConfigs.chat_tabular_semantic_columns_enabled === 'true' || siteConfigs.chat_tabular_semantic_columns_enabled === '1';
    const isCorpusTableEnabled = siteConfigs.chat_corpus_table_enabled === 'true' || siteConfigs.chat_corpus_table_enabled === '1';

    const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch { /* ignore corrupt entry */ }
        return { general: true };
    });
    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(openMap)); } catch { /* quota or disabled storage */ }
    }, [openMap]);

    const [filter, setFilter] = useState('');
    const trimmedFilter = filter.trim().toLowerCase();

    const sectionSearch = useMemo(() => {
        const r: Record<string, string> = {};
        for (const s of SECTION_CONFIGS) {
            const parts: string[] = [t(s.titleKey)];
            for (const k of s.i18nKeys) parts.push(t(k));
            for (const k of s.settingKeys) parts.push(k);
            r[s.id] = parts.join(' ').toLowerCase();
        }
        return r;
    }, [t]);

    const sectionState = (id: SectionId) => {
        const isFiltering = trimmedFilter.length > 0;
        const matches = isFiltering ? sectionSearch[id]?.includes(trimmedFilter) : true;
        return {
            hidden: isFiltering && !matches,
            open: isFiltering ? !!matches : !!openMap[id],
            onToggle: () => setOpenMap(prev => ({ ...prev, [id]: !prev[id] })),
        };
    };

    const expandAll = () => setOpenMap(Object.fromEntries(SECTION_CONFIGS.map(s => [s.id, true])));
    const collapseAll = () => setOpenMap({});

    return (
        <motion.div {...getMotionProps(reducedMotion)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="result-card" style={{ padding: '2rem' }}>
            <h3 style={{ marginTop: 0 }}>{t('agentConfig')}</h3>
            <p style={{ opacity: 0.7 }}>{t('agentConfigDesc')}</p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
                {/* `leadingIcon` is the DS's own search-field pattern: it owns the
                  * relative wrapper, the absolute icon and the left padding, which is
                  * why the hand-positioned <Search> and its inline styles are gone.
                  * The icon is decorative (aria-hidden inside the DS), so the field
                  * needs a real accessible name — it had none before, only a
                  * placeholder. */}
                <div className="max-w-[480px] flex-[1_1_280px]">
                    <Input
                        type="text"
                        leadingIcon={<Search />}
                        aria-label={t('agentFilterPlaceholder')}
                        placeholder={t('agentFilterPlaceholder')}
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                </div>
                <Button variant="outline" size="sm" type="button" onClick={expandAll}>
                    {t('agentExpandAll')}
                </Button>
                <Button variant="outline" size="sm" type="button" onClick={collapseAll}>
                    {t('agentCollapseAll')}
                </Button>
            </div>

            {/* `form-grid` dropped: it has no CSS rule anywhere in the repo, same as
              * the `input-group` that used to wrap every row. */}
            <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>

                <Section title={t('agentSectionGeneral')} {...sectionState('general')}>
                    <FieldRow
                        label={t('defaultTopK')}
                        help={t('defaultTopKHelp')}
                        type="number"
                        min="1"
                        max="50"
                        value={siteConfigs.default_top_k || '5'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, default_top_k: e.target.value }))}
                    />

                    <FieldRow
                        label={t('scoreDropThreshold')}
                        help={t('scoreDropThresholdHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={siteConfigs.score_drop_threshold || '0.15'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, score_drop_threshold: e.target.value }))}
                    />

                    <FieldRow
                        label={t('contextWindowSize')}
                        help={t('contextWindowSizeHelp')}
                        type="number"
                        min="0"
                        max="5"
                        value={siteConfigs.context_window_size || '1'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, context_window_size: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatAnswerTemperature')}
                        help={t('chatAnswerTemperatureHelp')}
                        type="number"
                        min="0"
                        max="2"
                        step="0.05"
                        value={siteConfigs.chat_answer_temperature ?? '0.3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_answer_temperature: e.target.value }))}
                    />
                </Section>

                <Section title={t('agentSectionHybridSearch')} {...sectionState('hybrid')}>
                    <FieldRow
                        label={t('minSimilarityThreshold')}
                        help={t('minSimilarityThresholdHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={siteConfigs.min_similarity_threshold || '0.3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, min_similarity_threshold: e.target.value }))}
                    />

                    <FieldRow
                        label={t('mmrLambda')}
                        help={t('mmrLambdaHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={siteConfigs.mmr_lambda || '0.7'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, mmr_lambda: e.target.value }))}
                    />

                    <FieldRow
                        label={t('rrfWeightVector')}
                        help={t('rrfWeightVectorHelp')}
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        value={siteConfigs.rrf_weight_vector || '1.0'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, rrf_weight_vector: e.target.value }))}
                    />

                    <FieldRow
                        label={t('rrfWeightBM25')}
                        help={t('rrfWeightBM25Help')}
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        value={siteConfigs.rrf_weight_bm25 || '1.0'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, rrf_weight_bm25: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('bm25SimpleArmEnabled')}
                        help={t('bm25SimpleArmEnabledHelp')}
                        checked={siteConfigs.bm25_simple_arm_enabled === 'true' || siteConfigs.bm25_simple_arm_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, bm25_simple_arm_enabled: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('bm25TieredBoostEnabled')}
                        help={t('bm25TieredBoostEnabledHelp')}
                        checked={siteConfigs.bm25_tiered_boost_enabled === 'true' || siteConfigs.bm25_tiered_boost_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, bm25_tiered_boost_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('hnswEfSearch')}
                        help={t('hnswEfSearchHelp')}
                        type="number"
                        min="1"
                        max="1000"
                        step="10"
                        value={siteConfigs.hnsw_ef_search || '150'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, hnsw_ef_search: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('mrlTwoPassEnabled')}
                        help={t('mrlTwoPassEnabledHelp')}
                        checked={siteConfigs.mrl_two_pass_enabled === 'true' || siteConfigs.mrl_two_pass_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, mrl_two_pass_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('queryInstruction')}
                        help={t('queryInstructionHelp')}
                        width="wide"
                        type="text"
                        placeholder="Given a question, retrieve all relevant passages that provide information to answer it"
                        value={siteConfigs.query_instruction || ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, query_instruction: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('hyPESearchEnabled')}
                        checked={siteConfigs.hype_search_enabled === 'true'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, hype_search_enabled: checked ? 'true' : 'false' }))}
                    />
                </Section>

                <Section title={t('agentSectionReranker')} {...sectionState('reranker')}>
                    <FieldRow
                        label={t('rerankBlendAlpha')}
                        help={t('rerankBlendAlphaHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={siteConfigs.rerank_blend_alpha || '0.5'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, rerank_blend_alpha: e.target.value }))}
                    />

                    <FieldRow
                        label={t('rerankBlendAlphaLookup')}
                        help={t('rerankBlendAlphaLookupHelp')}
                        type="number"
                        min="-1"
                        max="1"
                        step="0.05"
                        placeholder="-1 (inherit)"
                        value={siteConfigs.rerank_blend_alpha_lookup ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, rerank_blend_alpha_lookup: e.target.value }))}
                    />

                    <FieldRow
                        label={t('rerankBlendAlphaEnumeration')}
                        help={t('rerankBlendAlphaEnumerationHelp')}
                        type="number"
                        min="-1"
                        max="1"
                        step="0.05"
                        placeholder="-1 (inherit)"
                        value={siteConfigs.rerank_blend_alpha_enumeration ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, rerank_blend_alpha_enumeration: e.target.value }))}
                    />

                    <FieldRow
                        label={t('rerankBlendAlphaComplexReasoning')}
                        help={t('rerankBlendAlphaComplexReasoningHelp')}
                        type="number"
                        min="-1"
                        max="1"
                        step="0.05"
                        placeholder="-1 (inherit)"
                        value={siteConfigs.rerank_blend_alpha_complex_reasoning ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, rerank_blend_alpha_complex_reasoning: e.target.value }))}
                    />

                    <FieldRow
                        label={t('rerankBlendAlphaEntity')}
                        help={t('rerankBlendAlphaEntityHelp')}
                        type="number"
                        min="-1"
                        max="1"
                        step="0.05"
                        placeholder="-1 (inherit)"
                        value={siteConfigs.rerank_blend_alpha_entity ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, rerank_blend_alpha_entity: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('hybridDynamicAlphaEnabled')}
                        help={t('hybridDynamicAlphaEnabledHelp')}
                        checked={siteConfigs.hybrid_dynamic_alpha_enabled === 'true' || siteConfigs.hybrid_dynamic_alpha_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, hybrid_dynamic_alpha_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('hybridDynamicAlphaSensitivity')}
                        help={t('hybridDynamicAlphaSensitivityHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={siteConfigs.hybrid_dynamic_alpha_sensitivity || '0.3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, hybrid_dynamic_alpha_sensitivity: e.target.value }))}
                        disabled={!(siteConfigs.hybrid_dynamic_alpha_enabled === 'true' || siteConfigs.hybrid_dynamic_alpha_enabled === '1')}
                    />

                    <CheckboxFieldRow
                        label={t('rerankUseChatTemplate')}
                        help={t('rerankUseChatTemplateHelp')}
                        checked={siteConfigs.rerank_use_chat_template === 'true'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, rerank_use_chat_template: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('rerankInstruction')}
                        help={t('rerankInstructionHelp')}
                        width="wide"
                        type="text"
                        placeholder="Given a web search query, retrieve relevant passages that answer the query"
                        value={siteConfigs.rerank_instruction || ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, rerank_instruction: e.target.value }))}
                        disabled={siteConfigs.rerank_use_chat_template !== 'true'}
                    />
                </Section>

                <Section title={t('agentSectionPerRouteTopN')} {...sectionState('topn')}>
                    <FieldRow
                        label={t('topNLookup')}
                        help={t('topNLookupHelp')}
                        type="number"
                        min="0"
                        max="50"
                        step="1"
                        placeholder="0 (inherit default_top_k)"
                        value={siteConfigs.top_n_lookup ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, top_n_lookup: e.target.value }))}
                    />

                    <FieldRow
                        label={t('topNEnumeration')}
                        help={t('topNEnumerationHelp')}
                        type="number"
                        min="0"
                        max="50"
                        step="1"
                        placeholder="0 (inherit default_top_k)"
                        value={siteConfigs.top_n_enumeration ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, top_n_enumeration: e.target.value }))}
                    />

                    <FieldRow
                        label={t('topNComplexReasoning')}
                        help={t('topNComplexReasoningHelp')}
                        type="number"
                        min="0"
                        max="50"
                        step="1"
                        placeholder="0 (inherit default_top_k)"
                        value={siteConfigs.top_n_complex_reasoning ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, top_n_complex_reasoning: e.target.value }))}
                    />
                </Section>

                <Section title={t('agentSectionCompression')} {...sectionState('compression')}>
                    <CheckboxFieldRow
                        label={t('chatContextCompressionEnabled')}
                        help={t('chatContextCompressionEnabledHelp')}
                        checked={siteConfigs.chat_context_compression_enabled === 'true' || siteConfigs.chat_context_compression_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_context_compression_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatContextCompressionMinChunks')}
                        help={t('chatContextCompressionMinChunksHelp')}
                        type="number"
                        min={1}
                        max={50}
                        step={1}
                        value={siteConfigs.chat_context_compression_min_chunks || '15'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_context_compression_min_chunks: e.target.value }))}
                        disabled={!(siteConfigs.chat_context_compression_enabled === 'true' || siteConfigs.chat_context_compression_enabled === '1')}
                    />

                    <FieldRow
                        label={t('chatContextCompressionThreshold')}
                        help={t('chatContextCompressionThresholdHelp')}
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={siteConfigs.chat_context_compression_threshold || '0.3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_context_compression_threshold: e.target.value }))}
                        disabled={!(siteConfigs.chat_context_compression_enabled === 'true' || siteConfigs.chat_context_compression_enabled === '1')}
                    />

                    <FieldRow
                        label={t('chatContextCompressionModel')}
                        help={t('chatContextCompressionModelHelp')}
                        type="text"
                        placeholder="(fast-tier default)"
                        value={siteConfigs.chat_context_compression_model ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_context_compression_model: e.target.value }))}
                        disabled={!(siteConfigs.chat_context_compression_enabled === 'true' || siteConfigs.chat_context_compression_enabled === '1')}
                    />
                </Section>

                <Section title={t('agentSectionQueryEnhancement')} {...sectionState('queryEnh')}>
                    <CheckboxFieldRow
                        label={t('autoSpellCorrect')}
                        help={t('autoSpellCorrectHelp')}
                        checked={siteConfigs.auto_spell_correct !== 'false'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, auto_spell_correct: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('stepBackEnabled')}
                        help={t('stepBackEnabledHelp')}
                        checked={siteConfigs.step_back_enabled === 'true' || siteConfigs.step_back_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, step_back_enabled: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('queryDecomposeEnabled')}
                        help={t('queryDecomposeEnabledHelp')}
                        checked={siteConfigs.query_decompose_enabled === 'true' || siteConfigs.query_decompose_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, query_decompose_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('queryDecomposeModel')}
                        help={t('queryDecomposeModelHelp')}
                        type="text"
                        placeholder="(fast-tier default)"
                        value={siteConfigs.query_decompose_model ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, query_decompose_model: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatLongcontextEnabled')}
                        help={t('chatLongcontextEnabledHelp')}
                        checked={siteConfigs.chat_longcontext_enabled === 'true' || siteConfigs.chat_longcontext_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_longcontext_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatLongcontextMaxTokens')}
                        help={t('chatLongcontextMaxTokensHelp')}
                        type="number"
                        min={10000}
                        max={500000}
                        step={5000}
                        value={siteConfigs.chat_longcontext_max_tokens || '100000'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_longcontext_max_tokens: e.target.value }))}
                        disabled={!(siteConfigs.chat_longcontext_enabled === 'true' || siteConfigs.chat_longcontext_enabled === '1')}
                    />

                    <CheckboxFieldRow
                        label={t('queryCacheEnabled')}
                        help={t('queryCacheEnabledHelp')}
                        checked={isQueryCacheEnabled}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, query_cache_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('queryCacheSimilarityThreshold')}
                        help={t('queryCacheSimilarityThresholdHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        placeholder="0.96"
                        value={siteConfigs.query_cache_similarity_threshold ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, query_cache_similarity_threshold: e.target.value }))}
                        disabled={!isQueryCacheEnabled}
                    />

                    <FieldRow
                        label={t('queryCacheSimilarityThresholdLookup')}
                        help={t('queryCacheSimilarityThresholdLookupHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        placeholder="(inherit)"
                        value={siteConfigs.query_cache_similarity_threshold_lookup ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, query_cache_similarity_threshold_lookup: e.target.value }))}
                        disabled={!isQueryCacheEnabled}
                    />

                    <FieldRow
                        label={t('queryCacheSimilarityThresholdEnumeration')}
                        help={t('queryCacheSimilarityThresholdEnumerationHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        placeholder="(inherit)"
                        value={siteConfigs.query_cache_similarity_threshold_enumeration ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, query_cache_similarity_threshold_enumeration: e.target.value }))}
                        disabled={!isQueryCacheEnabled}
                    />

                    <FieldRow
                        label={t('queryCacheSimilarityThresholdComplexReasoning')}
                        help={t('queryCacheSimilarityThresholdComplexReasoningHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        placeholder="(inherit)"
                        value={siteConfigs.query_cache_similarity_threshold_complex_reasoning ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, query_cache_similarity_threshold_complex_reasoning: e.target.value }))}
                        disabled={!isQueryCacheEnabled}
                    />

                    <FieldRow
                        label={t('queryCacheTtlHours')}
                        help={t('queryCacheTtlHoursHelp')}
                        type="number"
                        min="1"
                        max="720"
                        step="1"
                        placeholder="24"
                        value={siteConfigs.query_cache_ttl_hours ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, query_cache_ttl_hours: e.target.value }))}
                        disabled={!isQueryCacheEnabled}
                    />
                </Section>

                <Section title={t('agentSectionCragAdaptive')} {...sectionState('crag')}>
                    <CheckboxFieldRow
                        label={t('cragEnabled')}
                        help={t('cragEnabledHelp')}
                        checked={isCragEnabled}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, crag_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('cragMinRelevantChunks')}
                        help={t('cragMinRelevantChunksHelp')}
                        type="number"
                        min="1"
                        max="10"
                        value={siteConfigs.crag_min_relevant_chunks || '3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, crag_min_relevant_chunks: e.target.value }))}
                        disabled={!isCragEnabled}
                    />

                    <CheckboxFieldRow
                        label={t('adaptiveRoutingEnabled')}
                        help={t('adaptiveRoutingEnabledHelp')}
                        checked={siteConfigs.adaptive_routing_enabled === 'true' || siteConfigs.adaptive_routing_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, adaptive_routing_enabled: checked ? 'true' : 'false' }))}
                    />
                </Section>

                <Section title={t('agentSectionGraph')} {...sectionState('graph')}>
                    <CheckboxFieldRow
                        label={t('kgExtractionEnabled')}
                        help={t('kgExtractionEnabledHelp')}
                        checked={siteConfigs.kg_extraction_enabled === 'true' || siteConfigs.kg_extraction_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, kg_extraction_enabled: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatGraphRoutingEnabled')}
                        help={t('chatGraphRoutingEnabledHelp')}
                        checked={siteConfigs.chat_graph_routing_enabled === 'true' || siteConfigs.chat_graph_routing_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_graph_routing_enabled: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatGraphRoutingInjectChunks')}
                        help={t('chatGraphRoutingInjectChunksHelp')}
                        checked={siteConfigs.chat_graph_routing_inject_chunks === 'true' || siteConfigs.chat_graph_routing_inject_chunks === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_graph_routing_inject_chunks: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatGraphRoutingMaxChunks')}
                        help={t('chatGraphRoutingMaxChunksHelp')}
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        value={siteConfigs.chat_graph_routing_max_chunks || '15'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_graph_routing_max_chunks: e.target.value }))}
                    />

                    <SelectFieldRow
                        label={t('chatGraphRoutingPathMode')}
                        help={t('chatGraphRoutingPathModeHelp')}
                        value={siteConfigs.chat_graph_routing_path_mode || 'neighbors'}
                        onValueChange={value => setSiteConfigs(prev => ({ ...prev, chat_graph_routing_path_mode: value }))}
                        options={[
                            { value: 'neighbors', label: t('chatGraphRoutingPathModeNeighbors') },
                            { value: 'ppr', label: t('chatGraphRoutingPathModePPR') },
                            { value: 'paths', label: t('chatGraphRoutingPathModePaths') },
                        ]}
                    />

                    <FieldRow
                        label={t('chatGraphRoutingPPRDamping')}
                        help={t('chatGraphRoutingPPRDampingHelp')}
                        type="number"
                        min="0.01"
                        max="0.99"
                        step="0.05"
                        value={siteConfigs.chat_graph_routing_ppr_damping || '0.85'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_graph_routing_ppr_damping: e.target.value }))}
                        disabled={(siteConfigs.chat_graph_routing_path_mode || 'neighbors') !== 'ppr'}
                    />

                    <FieldRow
                        label={t('chatGraphRoutingPPRMaxIter')}
                        help={t('chatGraphRoutingPPRMaxIterHelp')}
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={siteConfigs.chat_graph_routing_ppr_max_iter || '20'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_graph_routing_ppr_max_iter: e.target.value }))}
                        disabled={(siteConfigs.chat_graph_routing_path_mode || 'neighbors') !== 'ppr'}
                    />

                    <FieldRow
                        label={t('chatGraphRoutingPPRTopEntities')}
                        help={t('chatGraphRoutingPPRTopEntitiesHelp')}
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        value={siteConfigs.chat_graph_routing_ppr_top_entities || '10'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_graph_routing_ppr_top_entities: e.target.value }))}
                        disabled={(siteConfigs.chat_graph_routing_path_mode || 'neighbors') !== 'ppr'}
                    />

                    <FieldRow
                        label={t('chatGraphRoutingPathsMaxLen')}
                        help={t('chatGraphRoutingPathsMaxLenHelp')}
                        type="number"
                        min="1"
                        max="6"
                        step="1"
                        value={siteConfigs.chat_graph_routing_paths_max_len || '3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_graph_routing_paths_max_len: e.target.value }))}
                        disabled={(siteConfigs.chat_graph_routing_path_mode || 'neighbors') !== 'paths'}
                    />

                    <FieldRow
                        label={t('chatGraphRoutingPathsMaxPaths')}
                        help={t('chatGraphRoutingPathsMaxPathsHelp')}
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        value={siteConfigs.chat_graph_routing_paths_max_paths || '5'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_graph_routing_paths_max_paths: e.target.value }))}
                        disabled={(siteConfigs.chat_graph_routing_path_mode || 'neighbors') !== 'paths'}
                    />
                </Section>

                <Section title={t('agentSectionMultiStep')} {...sectionState('multistep')}>
                    <CheckboxFieldRow
                        label={t('chatKBRouterEnabled')}
                        help={t('chatKBRouterEnabledHelp')}
                        checked={siteConfigs.chat_kb_router_enabled === 'true' || siteConfigs.chat_kb_router_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_kb_router_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatKBRouterMinConfidence')}
                        help={t('chatKBRouterMinConfidenceHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={siteConfigs.chat_kb_router_min_confidence || '0.6'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_kb_router_min_confidence: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatTurnBudgetSeconds')}
                        help={t('chatTurnBudgetSecondsHelp')}
                        type="number"
                        min="0"
                        max="600"
                        value={siteConfigs.chat_turn_budget_seconds || '0'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_turn_budget_seconds: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatTurnBudgetTokens')}
                        help={t('chatTurnBudgetTokensHelp')}
                        type="number"
                        min="0"
                        max="2000000"
                        value={siteConfigs.chat_turn_budget_tokens || '0'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_turn_budget_tokens: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatTurnBudgetToolCalls')}
                        help={t('chatTurnBudgetToolCallsHelp')}
                        type="number"
                        min="0"
                        max="100"
                        value={siteConfigs.chat_turn_budget_tool_calls || '0'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_turn_budget_tool_calls: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatAgenticEnabled')}
                        help={t('chatAgenticEnabledHelp')}
                        checked={siteConfigs.chat_agentic_enabled === 'true' || siteConfigs.chat_agentic_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_agentic_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatAgenticMaxHops')}
                        help={t('chatAgenticMaxHopsHelp')}
                        type="number"
                        min="1"
                        max="5"
                        step="1"
                        value={siteConfigs.chat_agentic_max_hops || '3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_agentic_max_hops: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatPlanExecuteEnabled')}
                        help={t('chatPlanExecuteEnabledHelp')}
                        checked={siteConfigs.chat_plan_execute_enabled === 'true' || siteConfigs.chat_plan_execute_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_plan_execute_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatPlanExecuteMaxSubQueries')}
                        help={t('chatPlanExecuteMaxSubQueriesHelp')}
                        type="number"
                        min="1"
                        max="5"
                        step="1"
                        value={siteConfigs.chat_plan_execute_max_sub_queries || '3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_plan_execute_max_sub_queries: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatPlanExecuteMaxIterations')}
                        help={t('chatPlanExecuteMaxIterationsHelp')}
                        type="number"
                        min="1"
                        max="5"
                        step="1"
                        value={siteConfigs.chat_plan_execute_max_iterations || '3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_plan_execute_max_iterations: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatPlanExecuteTokenBudget')}
                        help={t('chatPlanExecuteTokenBudgetHelp')}
                        type="number"
                        min="2000"
                        max="32000"
                        step="500"
                        value={siteConfigs.chat_plan_execute_token_budget || '8000'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_plan_execute_token_budget: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatPlanExecuteToolAware')}
                        help={t('chatPlanExecuteToolAwareHelp')}
                        checked={siteConfigs.chat_plan_execute_tool_aware === 'true' || siteConfigs.chat_plan_execute_tool_aware === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_plan_execute_tool_aware: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatPlanExecuteDAGIterative')}
                        help={t('chatPlanExecuteDAGIterativeHelp')}
                        checked={siteConfigs.chat_plan_execute_dag_iterative === 'true' || siteConfigs.chat_plan_execute_dag_iterative === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_plan_execute_dag_iterative: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatAnswerToolsEnabled')}
                        help={t('chatAnswerToolsEnabledHelp')}
                        checked={siteConfigs.chat_answer_tools_enabled === 'true' || siteConfigs.chat_answer_tools_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_answer_tools_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatAnswerToolsMaxRounds')}
                        help={t('chatAnswerToolsMaxRoundsHelp')}
                        type="number"
                        min="1"
                        max="10"
                        step="1"
                        value={siteConfigs.chat_answer_tools_max_rounds || '5'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_answer_tools_max_rounds: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatSupervisorEnabled')}
                        help={t('chatSupervisorEnabledHelp')}
                        checked={siteConfigs.chat_supervisor_enabled === 'true' || siteConfigs.chat_supervisor_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_supervisor_enabled: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatSupervisorMultiSpecialist')}
                        help={t('chatSupervisorMultiSpecialistHelp')}
                        checked={siteConfigs.chat_supervisor_multi_specialist === 'true' || siteConfigs.chat_supervisor_multi_specialist === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_supervisor_multi_specialist: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatDriftEnabled')}
                        help={t('chatDriftEnabledHelp')}
                        checked={siteConfigs.chat_drift_enabled === 'true' || siteConfigs.chat_drift_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_drift_enabled: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatCommunitySearchEnabled')}
                        help={t('chatCommunitySearchEnabledHelp')}
                        checked={siteConfigs.chat_community_search_enabled === 'true' || siteConfigs.chat_community_search_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_community_search_enabled: checked ? 'true' : 'false' }))}
                    />
                </Section>

                <Section title={t('agentSectionConversation')} {...sectionState('conversation')}>
                    <CheckboxFieldRow
                        label={t('chatAnswerHistoryEnabled')}
                        help={t('chatAnswerHistoryEnabledHelp')}
                        checked={siteConfigs.chat_answer_history_enabled !== 'false' && siteConfigs.chat_answer_history_enabled !== '0'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_answer_history_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatAnswerHistoryMessages')}
                        help={t('chatAnswerHistoryMessagesHelp')}
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        value={siteConfigs.chat_answer_history_messages || '6'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_answer_history_messages: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatAnswerHistoryMaxChars')}
                        help={t('chatAnswerHistoryMaxCharsHelp')}
                        type="number"
                        min="200"
                        max="32000"
                        step="100"
                        value={siteConfigs.chat_answer_history_max_chars || '4000'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_answer_history_max_chars: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatTransformFollowupEnabled')}
                        help={t('chatTransformFollowupEnabledHelp')}
                        checked={siteConfigs.chat_transform_followup_enabled !== 'false' && siteConfigs.chat_transform_followup_enabled !== '0'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_transform_followup_enabled: checked ? 'true' : 'false' }))}
                    />
                </Section>

                <Section title={t('agentSectionCorpusTable')} {...sectionState('corpusTable')}>
                    <CheckboxFieldRow
                        label={t('chatCorpusTableEnabled')}
                        help={t('chatCorpusTableEnabledHelp')}
                        checked={isCorpusTableEnabled}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_corpus_table_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatCorpusTableModel')}
                        help={t('chatCorpusTableModelHelp')}
                        type="text"
                        placeholder="(fast-tier default)"
                        value={siteConfigs.chat_corpus_table_model ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_corpus_table_model: e.target.value }))}
                        disabled={!isCorpusTableEnabled}
                    />

                    <FieldRow
                        label={t('chatCorpusTableMaxFiles')}
                        help={t('chatCorpusTableMaxFilesHelp')}
                        type="number"
                        min={1}
                        max={500}
                        step={1}
                        value={siteConfigs.chat_corpus_table_max_files || '50'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_corpus_table_max_files: e.target.value }))}
                        disabled={!isCorpusTableEnabled}
                    />

                    <FieldRow
                        label={t('chatCorpusTableConcurrency')}
                        help={t('chatCorpusTableConcurrencyHelp')}
                        type="number"
                        min={1}
                        max={50}
                        step={1}
                        value={siteConfigs.chat_corpus_table_concurrency || '6'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_corpus_table_concurrency: e.target.value }))}
                        disabled={!isCorpusTableEnabled}
                    />

                    <CheckboxFieldRow
                        label={t('chatCorpusTableRouterLlmEnabled')}
                        help={t('chatCorpusTableRouterLlmEnabledHelp')}
                        checked={siteConfigs.chat_corpus_table_router_llm_enabled !== 'false' && siteConfigs.chat_corpus_table_router_llm_enabled !== '0'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_corpus_table_router_llm_enabled: checked ? 'true' : 'false' }))}
                        disabled={!isCorpusTableEnabled}
                    />
                </Section>

                <Section title={t('agentSectionCompare')} {...sectionState('compare')}>
                    <CheckboxFieldRow
                        label={t('chatCompareEnabled')}
                        help={t('chatCompareEnabledHelp')}
                        checked={siteConfigs.chat_compare_enabled === 'true' || siteConfigs.chat_compare_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_compare_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatCompareModel')}
                        help={t('chatCompareModelHelp')}
                        type="text"
                        placeholder="(fast-tier default)"
                        value={siteConfigs.chat_compare_model ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_compare_model: e.target.value }))}
                        disabled={!(siteConfigs.chat_compare_enabled === 'true' || siteConfigs.chat_compare_enabled === '1')}
                    />

                    <FieldRow
                        label={t('chatCompareMaxSections')}
                        help={t('chatCompareMaxSectionsHelp')}
                        type="number"
                        min={1}
                        max={500}
                        step={1}
                        value={siteConfigs.chat_compare_max_sections || '60'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_compare_max_sections: e.target.value }))}
                        disabled={!(siteConfigs.chat_compare_enabled === 'true' || siteConfigs.chat_compare_enabled === '1')}
                    />

                    <FieldRow
                        label={t('chatCompareConcurrency')}
                        help={t('chatCompareConcurrencyHelp')}
                        type="number"
                        min={1}
                        max={32}
                        step={1}
                        value={siteConfigs.chat_compare_concurrency || '6'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_compare_concurrency: e.target.value }))}
                        disabled={!(siteConfigs.chat_compare_enabled === 'true' || siteConfigs.chat_compare_enabled === '1')}
                    />

                    <FieldRow
                        label={t('chatComparePeersPerSection')}
                        help={t('chatComparePeersPerSectionHelp')}
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        value={siteConfigs.chat_compare_peers_per_section || '5'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_compare_peers_per_section: e.target.value }))}
                        disabled={!(siteConfigs.chat_compare_enabled === 'true' || siteConfigs.chat_compare_enabled === '1')}
                    />

                    <FieldRow
                        label={t('chatCompareAttachmentTtlHours')}
                        help={t('chatCompareAttachmentTtlHoursHelp')}
                        type="number"
                        min={1}
                        max={720}
                        step={1}
                        value={siteConfigs.chat_compare_attachment_ttl_hours || '24'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_compare_attachment_ttl_hours: e.target.value }))}
                        disabled={!(siteConfigs.chat_compare_enabled === 'true' || siteConfigs.chat_compare_enabled === '1')}
                    />

                    <FieldRow
                        label={t('chatCompareMaxFileBytes')}
                        help={t('chatCompareMaxFileBytesHelp')}
                        type="number"
                        min={1024}
                        max={104857600}
                        step={1024}
                        value={siteConfigs.chat_compare_max_file_bytes || '10485760'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_compare_max_file_bytes: e.target.value }))}
                        disabled={!(siteConfigs.chat_compare_enabled === 'true' || siteConfigs.chat_compare_enabled === '1')}
                    />
                </Section>

                <Section title={t('agentSectionTeams')} {...sectionState('teams')}>
                    <CheckboxFieldRow
                        label={t('agentsAllowPrivilegedTools')}
                        help={t('agentsAllowPrivilegedToolsHelp')}
                        checked={siteConfigs.agents_allow_privileged_tools === 'true' || siteConfigs.agents_allow_privileged_tools === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, agents_allow_privileged_tools: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('agentTeamRouterModel')}
                        help={t('agentTeamRouterModelHelp')}
                        type="text"
                        placeholder="(fast-tier default)"
                        value={siteConfigs.agent_team_router_model ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, agent_team_router_model: e.target.value }))}
                    />
                </Section>

                <Section title={t('agentSectionLongmem')} {...sectionState('longmem')}>
                    <CheckboxFieldRow
                        label={t('chatLongmemEnabled')}
                        help={t('chatLongmemEnabledHelp')}
                        checked={siteConfigs.chat_longmem_enabled === 'true' || siteConfigs.chat_longmem_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_longmem_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatLongmemMinSalience')}
                        help={t('chatLongmemMinSalienceHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={siteConfigs.chat_longmem_min_salience || '0.5'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_longmem_min_salience: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatLongmemRecallTopK')}
                        help={t('chatLongmemRecallTopKHelp')}
                        type="number"
                        min="1"
                        max="20"
                        value={siteConfigs.chat_longmem_recall_top_k || '5'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_longmem_recall_top_k: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatLongmemDecayDays')}
                        help={t('chatLongmemDecayDaysHelp')}
                        type="number"
                        min="1"
                        max="365"
                        value={siteConfigs.chat_longmem_decay_days || '30'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_longmem_decay_days: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatLongmemRecallSemantic')}
                        help={t('chatLongmemRecallSemanticHelp')}
                        checked={siteConfigs.chat_longmem_recall_semantic === 'true' || siteConfigs.chat_longmem_recall_semantic === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_longmem_recall_semantic: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatLongmemConflictResolution')}
                        help={t('chatLongmemConflictResolutionHelp')}
                        checked={siteConfigs.chat_longmem_conflict_resolution === 'true' || siteConfigs.chat_longmem_conflict_resolution === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_longmem_conflict_resolution: checked ? 'true' : 'false' }))}
                        disabled={!(siteConfigs.chat_longmem_recall_semantic === 'true' || siteConfigs.chat_longmem_recall_semantic === '1')}
                    />

                    <FieldRow
                        label={t('chatLongmemConflictModel')}
                        help={t('chatLongmemConflictModelHelp')}
                        type="text"
                        placeholder="(fast-tier default)"
                        value={siteConfigs.chat_longmem_conflict_model ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_longmem_conflict_model: e.target.value }))}
                        disabled={!(siteConfigs.chat_longmem_conflict_resolution === 'true' || siteConfigs.chat_longmem_conflict_resolution === '1')}
                    />

                    <FieldRow
                        label={t('chatLongmemConflictCandidates')}
                        help={t('chatLongmemConflictCandidatesHelp')}
                        type="number"
                        min="1"
                        max="10"
                        step="1"
                        value={siteConfigs.chat_longmem_conflict_candidates || '3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_longmem_conflict_candidates: e.target.value }))}
                        disabled={!(siteConfigs.chat_longmem_conflict_resolution === 'true' || siteConfigs.chat_longmem_conflict_resolution === '1')}
                    />

                </Section>

                <Section title={t('agentSectionValidation')} {...sectionState('validation')}>
                    <CheckboxFieldRow
                        label={t('factcheckInChat')}
                        help={t('factcheckInChatHelp')}
                        checked={siteConfigs.factcheck_in_chat !== 'false' && siteConfigs.factcheck_in_chat !== '0'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, factcheck_in_chat: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('citationValidationEnabled')}
                        help={t('citationValidationEnabledHelp')}
                        checked={siteConfigs.citation_validation_enabled !== 'false' && siteConfigs.citation_validation_enabled !== '0'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, citation_validation_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('citationValidationSemanticThreshold')}
                        help={t('citationValidationSemanticThresholdHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={siteConfigs.citation_validation_semantic_threshold || '0.85'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, citation_validation_semantic_threshold: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatFactualityGateEnabled')}
                        help={t('chatFactualityGateEnabledHelp')}
                        checked={siteConfigs.chat_factuality_gate_enabled === 'true' || siteConfigs.chat_factuality_gate_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_factuality_gate_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatFactualityGateMaxRefines')}
                        help={t('chatFactualityGateMaxRefinesHelp')}
                        type="number"
                        min="0"
                        max="2"
                        step="1"
                        value={siteConfigs.chat_factuality_gate_max_refines || '1'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_factuality_gate_max_refines: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatSelfRAGEnabled')}
                        help={t('chatSelfRAGEnabledHelp')}
                        checked={siteConfigs.chat_self_rag_enabled === 'true' || siteConfigs.chat_self_rag_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_self_rag_enabled: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('ragasSamplingEnabled')}
                        help={t('ragasSamplingEnabledHelp')}
                        checked={siteConfigs.ragas_sampling_enabled === 'true' || siteConfigs.ragas_sampling_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, ragas_sampling_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('ragasSamplingRate')}
                        help={t('ragasSamplingRateHelp')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={siteConfigs.ragas_sampling_rate || '0.0'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, ragas_sampling_rate: e.target.value }))}
                    />
                </Section>

                <Section title={t('agentSectionIngestion')} {...sectionState('ingestion')}>
                    <CheckboxFieldRow
                        label={t('doclingEnabled')}
                        help={t('doclingEnabledHelp')}
                        checked={isDoclingEnabled}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, docling_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('doclingBaseUrl')}
                        help={t('doclingBaseUrlHelp')}
                        width="wide"
                        type="text"
                        placeholder="http://docling:5001"
                        value={siteConfigs.docling_base_url || ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, docling_base_url: e.target.value }))}
                        disabled={!isDoclingEnabled}
                    />

                    <CheckboxFieldRow
                        label={t('describeImageEnabled')}
                        help={t('describeImageEnabledHelp')}
                        checked={isDescribeImageEnabled}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, describe_image_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('describeImageModel')}
                        help={t('describeImageModelHelp')}
                        type="text"
                        placeholder="(fast-tier default)"
                        value={siteConfigs.describe_image_model ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, describe_image_model: e.target.value }))}
                        disabled={!isDescribeImageEnabled}
                    />

                    <CheckboxFieldRow
                        label={t('contextualEnrichment')}
                        help={t('contextualEnrichmentHelp')}
                        checked={isContextualEnrichmentEnabled}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, contextual_enrichment: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('embeddingBatchSize')}
                        help={t('embeddingBatchSizeHelp')}
                        type="number"
                        min="1"
                        max="500"
                        step="1"
                        value={siteConfigs.embedding_batch_size || '20'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, embedding_batch_size: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('lateChunkingEnabled')}
                        help={t('lateChunkingEnabledHelp')}
                        checked={siteConfigs.late_chunking_enabled === 'true' || siteConfigs.late_chunking_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, late_chunking_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('lateChunkingMaxInputTokens')}
                        help={t('lateChunkingMaxInputTokensHelp')}
                        type="number"
                        min="512"
                        max="32768"
                        step="512"
                        value={siteConfigs.late_chunking_max_input_tokens || '8192'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, late_chunking_max_input_tokens: e.target.value }))}
                        disabled={!(siteConfigs.late_chunking_enabled === 'true' || siteConfigs.late_chunking_enabled === '1')}
                    />

                    <CheckboxFieldRow
                        label={t('parentChildEnabled')}
                        help={t('parentChildEnabledHelp')}
                        checked={siteConfigs.parent_child_enabled === 'true' || siteConfigs.parent_child_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, parent_child_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('parentChunkSize')}
                        help={t('parentChunkSizeHelp')}
                        type="number"
                        min="128"
                        max="4096"
                        step="64"
                        value={siteConfigs.parent_chunk_size || '512'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, parent_chunk_size: e.target.value }))}
                    />

                    <FieldRow
                        label={t('childChunkSize')}
                        help={t('childChunkSizeHelp')}
                        type="number"
                        min="32"
                        max="512"
                        step="16"
                        value={siteConfigs.child_chunk_size || '128'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, child_chunk_size: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('raptorEnabled')}
                        help={t('raptorEnabledHelp')}
                        checked={siteConfigs.raptor_enabled === 'true' || siteConfigs.raptor_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, raptor_enabled: checked ? 'true' : 'false' }))}
                        footer={(siteConfigs.raptor_enabled === 'true' || siteConfigs.raptor_enabled === '1') &&
                            (siteConfigs.parent_child_enabled === 'true' || siteConfigs.parent_child_enabled === '1') ? (
                            // TODO: `--warning` is not defined anywhere in this app's CSS, so this
                            // has always rendered the hardcoded #d97706 fallback in BOTH themes.
                            // Carried over verbatim rather than silently recoloured — picking the
                            // right token (--warning-text? --color-warning?) is a design decision.
                            <p style={{ fontSize: '0.8rem', color: 'var(--warning, #d97706)', marginTop: '0.5rem' }}>
                                {t('raptorParentChildConflict')}
                            </p>
                        ) : null}
                    />

                    <FieldRow
                        label={t('raptorMinChunks')}
                        help={t('raptorMinChunksHelp')}
                        type="number"
                        min={5}
                        max={200}
                        step={5}
                        value={siteConfigs.raptor_min_chunks || '25'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, raptor_min_chunks: e.target.value }))}
                    />

                    <FieldRow
                        label={t('raptorMaxLevels')}
                        help={t('raptorMaxLevelsHelp')}
                        type="number"
                        min={2}
                        max={8}
                        step={1}
                        value={siteConfigs.raptor_max_levels || '4'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, raptor_max_levels: e.target.value }))}
                    />

                    <FieldRow
                        label={t('raptorBranchingFactor')}
                        help={t('raptorBranchingFactorHelp')}
                        type="number"
                        min={2}
                        max={20}
                        step={1}
                        value={siteConfigs.raptor_branching_factor || '5'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, raptor_branching_factor: e.target.value }))}
                        disabled={(siteConfigs.raptor_clustering_algorithm || 'kmeans') === 'leiden'}
                    />

                    <SelectFieldRow
                        label={t('raptorClusteringAlgorithm')}
                        help={t('raptorClusteringAlgorithmHelp')}
                        value={siteConfigs.raptor_clustering_algorithm || 'kmeans'}
                        onValueChange={value => setSiteConfigs(prev => ({ ...prev, raptor_clustering_algorithm: value }))}
                        options={[
                            { value: 'kmeans', label: t('raptorClusteringAlgorithmKMeans') },
                            { value: 'leiden', label: t('raptorClusteringAlgorithmLeiden') },
                        ]}
                    />

                    <FieldRow
                        label={t('raptorLeidenResolution')}
                        help={t('raptorLeidenResolutionHelp')}
                        type="number"
                        min={0.01}
                        max={10}
                        step={0.05}
                        value={siteConfigs.raptor_leiden_resolution || '1.0'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, raptor_leiden_resolution: e.target.value }))}
                        disabled={(siteConfigs.raptor_clustering_algorithm || 'kmeans') !== 'leiden'}
                    />

                    <CheckboxFieldRow
                        label={t('hyPEEnabled')}
                        checked={siteConfigs.hype_enabled === 'true'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, hype_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('hyPEQuestionsPerChunk')}
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        value={siteConfigs.hype_questions_per_chunk ?? '3'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, hype_questions_per_chunk: e.target.value }))}
                        disabled={siteConfigs.hype_enabled !== 'true'}
                    />

                    <FieldRow
                        label={t('hyPEModel')}
                        type="text"
                        placeholder="(fast-tier default)"
                        value={siteConfigs.hype_model ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, hype_model: e.target.value }))}
                        disabled={siteConfigs.hype_enabled !== 'true'}
                    />

                </Section>

                <Section title={t('agentSectionObservability')} {...sectionState('observability')}>
                    <FieldRow
                        label={t('langfuseBaseUrl')}
                        help={t('langfuseBaseUrlHelp')}
                        width="wide"
                        type="text"
                        placeholder="https://langfuse.example.local"
                        value={siteConfigs.langfuse_base_url || ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, langfuse_base_url: e.target.value }))}
                    />
                </Section>

                <Section title={t('agentSectionTools')} {...sectionState('tools')}>
                    <AdminMCPSection siteConfigs={siteConfigs} setSiteConfigs={setSiteConfigs} />

                    <CheckboxFieldRow
                        label={t('chatCodeExecEnabled')}
                        help={t('chatCodeExecEnabledHelp')}
                        width="wide"
                        checked={siteConfigs.chat_code_exec_enabled === 'true' || siteConfigs.chat_code_exec_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_code_exec_enabled: checked ? 'true' : 'false' }))}
                    />
                </Section>

                <Section title={t('agentSectionTabular')} {...sectionState('tabular')}>
                    <CheckboxFieldRow
                        label={t('chatTabularQueryEnabled')}
                        help={t('chatTabularQueryEnabledHelp')}
                        width="wide"
                        checked={siteConfigs.chat_tabular_query_enabled === 'true' || siteConfigs.chat_tabular_query_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_tabular_query_enabled: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatTabularSemanticColumnsEnabled')}
                        help={t('chatTabularSemanticColumnsEnabledHelp')}
                        width="wide"
                        checked={isTabularSemanticEnabled}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_tabular_semantic_columns_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('tabularSemanticMinAvgLen')}
                        help={t('tabularSemanticMinAvgLenHelp')}
                        type="number"
                        min={0}
                        step={1}
                        value={siteConfigs.tabular_semantic_min_avg_len || '32'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, tabular_semantic_min_avg_len: e.target.value }))}
                        disabled={!isTabularSemanticEnabled}
                    />

                    <FieldRow
                        label={t('tabularSemanticMinDistinctRatio')}
                        help={t('tabularSemanticMinDistinctRatioHelp')}
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={siteConfigs.tabular_semantic_min_distinct_ratio || '0.6'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, tabular_semantic_min_distinct_ratio: e.target.value }))}
                        disabled={!isTabularSemanticEnabled}
                    />

                    <CheckboxFieldRow
                        label={t('chatTabularChartsEnabled')}
                        help={t('chatTabularChartsEnabledHelp')}
                        width="wide"
                        checked={siteConfigs.chat_tabular_charts_enabled === 'true' || siteConfigs.chat_tabular_charts_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_tabular_charts_enabled: checked ? 'true' : 'false' }))}
                    />
                </Section>

                <Section title={t('agentSectionDateAware')} {...sectionState('dateAware')}>
                    <CheckboxFieldRow
                        label={t('chatDateAwarenessEnabled')}
                        help={t('chatDateAwarenessEnabledHelp')}
                        checked={siteConfigs.chat_date_awareness_enabled !== 'false' && siteConfigs.chat_date_awareness_enabled !== '0'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_date_awareness_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatDateTimezone')}
                        help={t('chatDateTimezoneHelp')}
                        type="text"
                        placeholder="Europe/Berlin"
                        value={siteConfigs.chat_date_timezone ?? ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_date_timezone: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatDateToolsEnabled')}
                        help={t('chatDateToolsEnabledHelp')}
                        checked={siteConfigs.chat_date_tools_enabled === 'true' || siteConfigs.chat_date_tools_enabled === '1'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_date_tools_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatDateToolsMaxResults')}
                        help={t('chatDateToolsMaxResultsHelp')}
                        type="number"
                        min="1"
                        max="500"
                        value={siteConfigs.chat_date_tools_max_results || '50'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_date_tools_max_results: e.target.value }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatRecencyListingEnabled')}
                        help={t('chatRecencyListingEnabledHelp')}
                        checked={siteConfigs.chat_recency_listing_enabled !== 'false' && siteConfigs.chat_recency_listing_enabled !== '0'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_recency_listing_enabled: checked ? 'true' : 'false' }))}
                    />

                    <CheckboxFieldRow
                        label={t('chatRecencyListingNameMatchEnabled')}
                        help={t('chatRecencyListingNameMatchEnabledHelp')}
                        checked={siteConfigs.chat_recency_listing_name_match_enabled !== 'false' && siteConfigs.chat_recency_listing_name_match_enabled !== '0'}
                        onCheckedChange={checked => setSiteConfigs(prev => ({ ...prev, chat_recency_listing_name_match_enabled: checked ? 'true' : 'false' }))}
                    />

                    <FieldRow
                        label={t('chatRecencyListingWindowDays')}
                        help={t('chatRecencyListingWindowDaysHelp')}
                        type="number"
                        min="1"
                        max="365"
                        value={siteConfigs.chat_recency_listing_window_days || '7'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_recency_listing_window_days: e.target.value }))}
                    />

                    <FieldRow
                        label={t('chatRecencyListingMaxResults')}
                        help={t('chatRecencyListingMaxResultsHelp')}
                        type="number"
                        min="1"
                        max="500"
                        value={siteConfigs.chat_recency_listing_max_results || '50'}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_recency_listing_max_results: e.target.value }))}
                    />
                </Section>

                {/* `.search-button` DOES have CSS (index.css:1308 — the legacy primary
                  * tier: accent-primary fill, --shape-md radius, flex+gap). Dropping the
                  * class is the point: the DS Button's `default` variant is that tier
                  * now. `width: fit-content` goes with it — Button is inline-flex, so it
                  * already sizes to its content, unlike the `.search-button` rule's
                  * `width: 100%` that the inline style existed to undo. */}
                <Button type="submit">
                    <Save size={18} /> {t('saveSettings')}
                </Button>
            </form>

            <AdminAgentMetricsCard />
        </motion.div>
    );
}
