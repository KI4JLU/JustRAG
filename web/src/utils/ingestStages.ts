/** Translation key of each ingest stage the worker reports (files.current_stage). */
export const INGEST_STAGE_LABEL_KEYS: Record<string, string> = {
    parse: 'ingestStageParse',
    tabular: 'ingestStageTabular',
    enrich: 'ingestStageEnrich',
    embed: 'ingestStageEmbed',
    kg: 'ingestStageKg',
    hype: 'ingestStageHype',
    raptor: 'ingestStageRaptor',
};
