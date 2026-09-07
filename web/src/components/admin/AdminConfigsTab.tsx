import { Plus, Trash2, CheckCircle2, Settings, Save, X, RefreshCw, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Input } from '@ki4jlu/design-system';
import { useReducedMotion, getMotionProps } from '../../hooks/useReducedMotion';
import { useTheme } from '../../contexts/ThemeContext';
import { parseDimensionsInput, formatDimensionsValue } from '../../utils/embeddingDimensions';
import {
    CheckboxFieldRow,
    FieldRow,
    SelectFieldRow,
    type SelectFieldRowOption,
} from '../form/FieldRow';
import type { ChatModelOption } from '../../AdminUI';

interface AIModel {
    id?: string;
    name: string;
    isReasoning: boolean;
    isEmbedding: boolean;
    isRerank: boolean;
    isTts: boolean;
    isStt: boolean;
    dimensions?: number;
}

interface AIConfig {
    id: string;
    name: string;
    provider: string;
    api_key: string;
    base_url?: string;
    chat_models: AIModel[];
    embedding_models: AIModel[];
    rerank_models: AIModel[];
    tts_models: AIModel[];
    stt_models: AIModel[];
    is_active: boolean;
}

interface ConnectionTest {
    configId: string;
    status: 'testing' | 'healthy' | 'unhealthy';
    latencyMs?: number;
    error?: string;
}

// Per-task model overrides surfaced in the AI Config tab. The backend
// resolution chain is: per-task key → model_tier_fast → KB chat model,
// so empty values fall through automatically.
const MODEL_JOBS: { key: string; labelKey: string; helpKey: string }[] = [
    { key: 'crag_grader_model', labelKey: 'cragGraderModel', helpKey: 'cragGraderModelHelp' },
    { key: 'kg_extraction_model', labelKey: 'kgExtractionModel', helpKey: 'kgExtractionModelHelp' },
    { key: 'contextual_enrichment_model', labelKey: 'contextualEnrichmentModel', helpKey: 'contextualEnrichmentModelHelp' },
    { key: 'chat_plan_execute_model', labelKey: 'chatPlanExecuteModel', helpKey: 'chatPlanExecuteModelHelp' },
    { key: 'chat_plan_execute_dag_iterative_model', labelKey: 'chatPlanExecuteDAGIterativeModel', helpKey: 'chatPlanExecuteDAGIterativeModelHelp' },
    { key: 'chat_longmem_extraction_model', labelKey: 'chatLongmemExtractionModel', helpKey: 'chatLongmemExtractionModelHelp' },
    { key: 'chat_self_rag_model', labelKey: 'chatSelfRAGModel', helpKey: 'chatSelfRAGModelHelp' },
    { key: 'raptor_summary_model', labelKey: 'raptorSummaryModel', helpKey: 'raptorSummaryModelHelp' },
];

interface AdminConfigsTabProps {
    configs: AIConfig[];
    showForm: boolean;
    editingId: string | null;
    configFormData: Partial<AIConfig>;
    setConfigFormData: React.Dispatch<React.SetStateAction<Partial<AIConfig>>>;
    connectionTest: ConnectionTest | null;
    setConnectionTest: React.Dispatch<React.SetStateAction<ConnectionTest | null>>;
    handleConfigSubmit: (e: React.FormEvent) => void;
    startEditConfig: (config: AIConfig) => void;
    handleDelete: (id: string, type: 'config' | 'auth') => void;
    handleActivate: (id: string) => void;
    resetForm: () => void;
    configValidation: {
        errors: Record<string, string>;
        clearError: (field: string) => void;
    };
    loading: boolean;
    siteConfigs: Record<string, string>;
    setSiteConfigs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onSiteConfigSubmit: (e: React.FormEvent) => void;
    availableChatModels: ChatModelOption[];
}

export default function AdminConfigsTab({
    configs,
    showForm,
    editingId,
    configFormData,
    setConfigFormData,
    connectionTest,
    setConnectionTest,
    handleConfigSubmit,
    startEditConfig,
    handleDelete,
    handleActivate,
    resetForm,
    configValidation,
    loading,
    siteConfigs,
    setSiteConfigs,
    onSiteConfigSubmit,
    availableChatModels,
}: AdminConfigsTabProps) {
    const reducedMotion = useReducedMotion();
    const { t } = useTheme();

    /**
     * Option list for a per-job model select.
     *
     * The empty string means "no override — fall through to model_tier_fast /
     * the KB chat model", which is a real choice the admin has to be able to
     * take back, so it stays a listed option. Radix reports `value === ''` as
     * "nothing selected" and renders the trigger's placeholder for it, which is
     * why every one of these rows also passes `placeholder`.
     */
    const modelOptions = (current: string): SelectFieldRowOption[] => {
        // `availableChatModels` lists one entry per (model, config) pair, so the
        // same model name can appear twice with different labels. The saved
        // value is the model NAME, so those two entries are the same choice —
        // and Radix keys its hidden native options by value, which makes a
        // repeated value a React duplicate-key warning plus two simultaneously
        // "checked" items. Collapsed here, first label wins.
        // TODO: whether the label should instead name every config the model
        // lives in is a product question, not decided here (KI-692).
        const seen = new Set<string>();
        const catalogue: SelectFieldRowOption[] = [];
        for (const m of availableChatModels) {
            if (seen.has(m.value)) continue;
            seen.add(m.value);
            catalogue.push({ value: m.value, label: m.label });
        }
        return [
            { value: '', label: t('useKbDefaultModel') },
            // If the saved value isn't in the catalogue (model removed or
            // renamed), keep it as an extra option so it stays visible until
            // the admin actively changes it.
            ...(current && !seen.has(current) ? [{ value: current, label: current }] : []),
            ...catalogue,
        ];
    };

    return (
        <>
            <AnimatePresence>
                {connectionTest && (
                    <motion.div
                        {...getMotionProps(reducedMotion)}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.75rem 1rem',
                            marginBottom: '1rem',
                            borderRadius: '8px',
                            background: connectionTest.status === 'testing'
                                ? 'var(--bg-secondary)'
                                : connectionTest.status === 'healthy'
                                    ? '#2d8f4e15'
                                    : '#c0392b15',
                            border: `1px solid ${connectionTest.status === 'testing'
                                ? 'var(--border-color)'
                                : connectionTest.status === 'healthy'
                                    ? '#2d8f4e'
                                    : '#c0392b'}`,
                        }}
                    >
                        {connectionTest.status === 'testing' && (
                            <RefreshCw size={18} className="spin" style={{ color: 'var(--text-secondary)' }} />
                        )}
                        {connectionTest.status === 'healthy' && (
                            <CheckCircle2 size={18} style={{ color: '#2d8f4e' }} />
                        )}
                        {connectionTest.status === 'unhealthy' && (
                            <AlertCircle size={18} style={{ color: '#c0392b' }} />
                        )}
                        <span style={{ flex: 1, fontSize: '0.9rem' }}>
                            {connectionTest.status === 'testing' && t('connectionTesting')}
                            {connectionTest.status === 'healthy' && `${t('connectionSuccess')} (${connectionTest.latencyMs}ms)`}
                            {connectionTest.status === 'unhealthy' && (connectionTest.error || t('connectionFailed'))}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setConnectionTest(null)}
                            aria-label={t('closeBanner')}
                        >
                            <X size={16} />
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showForm && (
                    <motion.div {...getMotionProps(reducedMotion)} initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="config-form-overlay">
                        <form onSubmit={handleConfigSubmit} className="result-card" style={{ padding: '2rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', alignItems: 'center' }}>
                                <h3 style={{ color: 'var(--text-primary)', margin: 0 }}>{editingId ? t('editConfig2') : t('newConfig')}</h3>
                                <Button type="button" variant="ghost" size="icon" onClick={resetForm} aria-label={t('closeForm')}><X size={20} /></Button>
                            </div>
                            {/* `form-grid` and the `input-group` wrappers are gone: neither has a
                              * CSS rule anywhere in the repo, so the `gridColumn: 'span 2'` the
                              * model sections carried was inert too (there was no grid). The
                              * rows are stacked here with an explicit gap, which the framed DS
                              * fields need — flush against each other they would touch. */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                <FieldRow
                                    label={t('configName')}
                                    placeholder={t('configNamePlaceholder')}
                                    value={configFormData.name ?? ''}
                                    error={configValidation.errors.name}
                                    onChange={e => { setConfigFormData({ ...configFormData, name: e.target.value }); configValidation.clearError('name'); }}
                                />

                                <SelectFieldRow
                                    label={t('provider')}
                                    value={configFormData.provider ?? 'openai'}
                                    onValueChange={value => setConfigFormData({ ...configFormData, provider: value })}
                                    options={[{ value: 'openai', label: 'OpenAI (OpenAI-compatible)' }]}
                                />

                                <FieldRow
                                    label={t('apiKey')}
                                    type="password"
                                    placeholder="sk-..."
                                    value={configFormData.api_key ?? ''}
                                    error={configValidation.errors.api_key}
                                    onChange={e => { setConfigFormData({ ...configFormData, api_key: e.target.value }); configValidation.clearError('api_key'); }}
                                />

                                <FieldRow
                                    label={t('baseUrl')}
                                    placeholder="https://api.openai.com/v1"
                                    value={configFormData.base_url ?? ''}
                                    onChange={e => setConfigFormData({ ...configFormData, base_url: e.target.value })}
                                />

                                {/* The five model lists below label a GROUP of controls, not a
                                  * single one, so they are fieldset/legend rather than a
                                  * <label> with nothing to point at (which is what they were).
                                  * Each row's field keeps its own accessible name via
                                  * aria-label, as before. */}

                                {/* Chat Models */}
                                <fieldset className="flex flex-col gap-2">
                                    <legend className="mb-2 font-label-sm text-label-sm text-on-surface-variant">{t('chatModels')}</legend>
                                    {(configFormData.chat_models || []).map((model, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <Input
                                                aria-label={`Chat model ${idx + 1}`}
                                                className="flex-1"
                                                value={model.name}
                                                onChange={e => {
                                                    const models = [...(configFormData.chat_models || [])];
                                                    models[idx] = { ...models[idx], name: e.target.value };
                                                    setConfigFormData({ ...configFormData, chat_models: models });
                                                }}
                                                placeholder="e.g. gpt-4o"
                                            />
                                            <CheckboxFieldRow
                                                label={t('reasoning')}
                                                checked={model.isReasoning}
                                                onCheckedChange={checked => {
                                                    const models = [...(configFormData.chat_models || [])];
                                                    models[idx] = { ...models[idx], isReasoning: checked };
                                                    setConfigFormData({ ...configFormData, chat_models: models });
                                                }}
                                            />
                                            {(configFormData.chat_models || []).length > 1 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost-destructive"
                                                    size="icon"
                                                    onClick={() => {
                                                        const models = (configFormData.chat_models || []).filter((_, i) => i !== idx);
                                                        setConfigFormData({ ...configFormData, chat_models: models });
                                                    }}
                                                    aria-label={t('removeModel')}
                                                >
                                                    <X size={16} />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        onClick={() => {
                                            const models = [...(configFormData.chat_models || []), { name: '', isReasoning: false, isEmbedding: false, isRerank: false, isTts: false, isStt: false }];
                                            setConfigFormData({ ...configFormData, chat_models: models });
                                        }}
                                    >
                                        <Plus size={16} /> {t('addModel')}
                                    </Button>
                                </fieldset>

                                {/* Embedding Models */}
                                <fieldset className="flex flex-col gap-2">
                                    <legend className="mb-2 font-label-sm text-label-sm text-on-surface-variant">{t('embeddingModels')}</legend>
                                    {(configFormData.embedding_models || []).map((model, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: '0.5rem' }}>
                                            <Input
                                                aria-label={`Embedding model ${idx + 1}`}
                                                className="flex-[2]"
                                                value={model.name}
                                                onChange={e => {
                                                    const models = [...(configFormData.embedding_models || [])];
                                                    models[idx] = { ...models[idx], name: e.target.value };
                                                    setConfigFormData({ ...configFormData, embedding_models: models });
                                                }}
                                                placeholder="e.g. text-embedding-3-small"
                                            />
                                            <Input
                                                aria-label={`Dimensions for embedding model ${idx + 1}`}
                                                type="number"
                                                min={0}
                                                className="w-[120px]"
                                                value={formatDimensionsValue(model.dimensions)}
                                                onChange={e => {
                                                    const models = [...(configFormData.embedding_models || [])];
                                                    models[idx] = { ...models[idx], dimensions: parseDimensionsInput(e.target.value) };
                                                    setConfigFormData({ ...configFormData, embedding_models: models });
                                                }}
                                                placeholder="auto"
                                                title={t('vectorDimensionsHelp')}
                                            />
                                            {(configFormData.embedding_models || []).length > 1 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost-destructive"
                                                    size="icon"
                                                    onClick={() => {
                                                        const models = (configFormData.embedding_models || []).filter((_, i) => i !== idx);
                                                        setConfigFormData({ ...configFormData, embedding_models: models });
                                                    }}
                                                    aria-label={t('removeModel')}
                                                >
                                                    <X size={16} />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        onClick={() => {
                                            const models = [...(configFormData.embedding_models || []), { name: '', isReasoning: false, isEmbedding: true, isRerank: false, isTts: false, isStt: false, dimensions: 0 }];
                                            setConfigFormData({ ...configFormData, embedding_models: models });
                                        }}
                                    >
                                        <Plus size={16} /> {t('addModel')}
                                    </Button>
                                </fieldset>

                                {/* Rerank Models */}
                                <fieldset className="flex flex-col gap-2">
                                    <legend className="mb-2 font-label-sm text-label-sm text-on-surface-variant">{t('rerankModels')}</legend>
                                    {(configFormData.rerank_models || []).map((model, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <Input
                                                aria-label={`Rerank model ${idx + 1}`}
                                                className="flex-1"
                                                value={model.name}
                                                onChange={e => {
                                                    const models = [...(configFormData.rerank_models || [])];
                                                    models[idx] = { ...models[idx], name: e.target.value };
                                                    setConfigFormData({ ...configFormData, rerank_models: models });
                                                }}
                                                placeholder="e.g. jina-reranker-v2-base-multilingual"
                                            />
                                            {(configFormData.rerank_models || []).length > 1 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost-destructive"
                                                    size="icon"
                                                    onClick={() => {
                                                        const models = (configFormData.rerank_models || []).filter((_, i) => i !== idx);
                                                        setConfigFormData({ ...configFormData, rerank_models: models });
                                                    }}
                                                    aria-label={t('removeModel')}
                                                >
                                                    <X size={16} />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        onClick={() => {
                                            const models = [...(configFormData.rerank_models || []), { name: '', isReasoning: false, isEmbedding: false, isRerank: true, isTts: false, isStt: false }];
                                            setConfigFormData({ ...configFormData, rerank_models: models });
                                        }}
                                    >
                                        <Plus size={16} /> {t('addModel')}
                                    </Button>
                                </fieldset>

                                {/* TTS Models */}
                                <fieldset className="flex flex-col gap-2">
                                    <legend className="mb-2 font-label-sm text-label-sm text-on-surface-variant">{t('ttsModels')}</legend>
                                    {(configFormData.tts_models || []).map((model, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <Input
                                                aria-label={`TTS model ${idx + 1}`}
                                                className="flex-1"
                                                value={model.name}
                                                onChange={e => {
                                                    const models = [...(configFormData.tts_models || [])];
                                                    models[idx] = { ...models[idx], name: e.target.value };
                                                    setConfigFormData({ ...configFormData, tts_models: models });
                                                }}
                                                placeholder="e.g. tts-1"
                                            />
                                            {(configFormData.tts_models || []).length > 1 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost-destructive"
                                                    size="icon"
                                                    onClick={() => {
                                                        const models = (configFormData.tts_models || []).filter((_, i) => i !== idx);
                                                        setConfigFormData({ ...configFormData, tts_models: models });
                                                    }}
                                                    aria-label={t('removeModel')}
                                                >
                                                    <X size={16} />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        onClick={() => {
                                            const models = [...(configFormData.tts_models || []), { name: '', isReasoning: false, isEmbedding: false, isRerank: false, isTts: true, isStt: false }];
                                            setConfigFormData({ ...configFormData, tts_models: models });
                                        }}
                                    >
                                        <Plus size={16} /> {t('addModel')}
                                    </Button>
                                </fieldset>

                                {/* STT Models */}
                                <fieldset className="flex flex-col gap-2">
                                    <legend className="mb-2 font-label-sm text-label-sm text-on-surface-variant">{t('sttModels')}</legend>
                                    {(configFormData.stt_models || []).map((model, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <Input
                                                aria-label={`STT model ${idx + 1}`}
                                                className="flex-1"
                                                value={model.name}
                                                onChange={e => {
                                                    const models = [...(configFormData.stt_models || [])];
                                                    models[idx] = { ...models[idx], name: e.target.value };
                                                    setConfigFormData({ ...configFormData, stt_models: models });
                                                }}
                                                placeholder="e.g. whisper-1"
                                            />
                                            {(configFormData.stt_models || []).length > 1 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost-destructive"
                                                    size="icon"
                                                    onClick={() => {
                                                        const models = (configFormData.stt_models || []).filter((_, i) => i !== idx);
                                                        setConfigFormData({ ...configFormData, stt_models: models });
                                                    }}
                                                    aria-label={t('removeModel')}
                                                >
                                                    <X size={16} />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        onClick={() => {
                                            const models = [...(configFormData.stt_models || []), { name: '', isReasoning: false, isEmbedding: false, isRerank: false, isTts: false, isStt: true }];
                                            setConfigFormData({ ...configFormData, stt_models: models });
                                        }}
                                    >
                                        <Plus size={16} /> {t('addModel')}
                                    </Button>
                                </fieldset>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                                <Button type="submit"><Save size={18} /> {t('saveConfig')}</Button>
                                <Button type="button" variant="outline" onClick={resetForm}>{t('cancel')}</Button>
                            </div>
                        </form>
                    </motion.div>
                )}
            </AnimatePresence>

            <form
                onSubmit={onSiteConfigSubmit}
                className="result-card"
                style={{ padding: '1.5rem 2rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
                <div>
                    <h3 style={{ margin: 0 }}>{t('modelsPerJob')}</h3>
                    <p style={{ opacity: 0.7, margin: '0.25rem 0 0', fontSize: '0.9rem' }}>{t('modelsPerJobDesc')}</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
                    {MODEL_JOBS.map(job => (
                        <SelectFieldRow
                            key={job.key}
                            label={t(job.labelKey)}
                            help={t(job.helpKey)}
                            placeholder={t('useKbDefaultModel')}
                            value={siteConfigs[job.key] || ''}
                            onValueChange={value => setSiteConfigs(prev => ({ ...prev, [job.key]: value }))}
                            options={modelOptions(siteConfigs[job.key] || '')}
                        />
                    ))}

                    <SelectFieldRow
                        label={t('modelTierFast')}
                        help={t('modelTierFastHelp')}
                        placeholder={t('useKbDefaultModel')}
                        value={siteConfigs.model_tier_fast || ''}
                        onValueChange={value => setSiteConfigs(prev => ({ ...prev, model_tier_fast: value }))}
                        options={modelOptions(siteConfigs.model_tier_fast || '')}
                    />
                </div>

                <Button type="submit" className="w-fit">
                    <Save size={18} /> {t('saveSettings')}
                </Button>
            </form>

            <div className="configs-list">
                {loading ? (
                    <div className="loading-spinner"></div>
                ) : configs.length === 0 ? (
                    <p style={{ textAlign: 'center', opacity: 0.5, padding: '3rem', color: 'var(--text-secondary)' }}>{t('noConfigsFound')}</p>
                ) : (
                    configs.map(config => (
                        <motion.div key={config.id} layout={!reducedMotion} className={`result-card ${config.is_active ? 'active-config' : ''}`}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <h3 style={{ margin: 0 }}>{config.name}</h3>
                                        {config.is_active && <span className="active-badge">{t('active')}</span>}
                                    </div>
                                    <p style={{ opacity: 0.7, margin: '0.2rem 0' }}>{t('provider')}: {config.provider}</p>
                                    <p style={{ opacity: 0.7, margin: '0.2rem 0' }}>{t('chatModels')}: {[...config.chat_models, ...config.embedding_models].map(m => m.name).join(', ')}</p>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    {!config.is_active && (
                                        <Button type="button" variant="ghost" size="icon" onClick={() => handleActivate(config.id)} title={t('activateConfig')} aria-label={t('activateConfig')}><CheckCircle2 size={20} /></Button>
                                    )}
                                    <Button type="button" variant="ghost" size="icon" onClick={() => startEditConfig(config)} title={t('editConfig')} aria-label={t('editConfig')}><Settings size={20} /></Button>
                                    <Button type="button" variant="ghost-destructive" size="icon" onClick={() => handleDelete(config.id, 'config')} title={t('deleteConfig')} aria-label={t('deleteConfig')}><Trash2 size={20} /></Button>
                                </div>
                            </div>
                        </motion.div>
                    ))
                )}
            </div>
        </>
    );
}
