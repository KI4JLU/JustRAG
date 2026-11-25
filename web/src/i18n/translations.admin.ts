/**
 * Strings of the admin console (components/admin, pages/GlobalKbSettings) that
 * used to be hardcoded in the components. Spread into `translations`;
 * placeholders in braces are replaced at the call site. Values the admin types
 * or the backend sends (model names, site_config keys, queue names, URLs) stay
 * literal at the call site and are not in here.
 */
export const adminTranslations = {
    // Shared
    admRetry: { de: 'Erneut versuchen', en: 'Try again' },
    admErrorPrefix: { de: 'Fehler: {error}', en: 'Error: {error}' },
    admExample: { de: 'z. B. {value}', en: 'e.g. {value}' },
    admNoData: { de: 'Keine Daten vorhanden', en: 'No data available' },
    admNone: { de: 'Keines', en: 'None' },

    // System Health (SystemHealthDashboard)
    admHealthLoading: { de: 'System Health wird geladen …', en: 'Loading system health…' },
    admHealthLastUpdated: { de: 'Zuletzt aktualisiert: {time}', en: 'Last updated: {time}' },
    admHealthAutoRefresh: { de: 'Automatisch aktualisieren (10 s)', en: 'Auto-refresh (10s)' },
    admHealthRefreshing: { de: 'Wird aktualisiert …', en: 'Refreshing…' },
    admHealthActiveUsers: { de: 'Aktive Benutzer', en: 'Active users' },
    admHealthLast15Min: { de: 'Letzte 15 Min.', en: 'Last 15 min' },
    admHealthProcessingSources: { de: 'Quellen in Verarbeitung', en: 'Sources processing' },
    admHealthTopics: { de: 'Themen', en: 'Topics' },
    admHealthTotalSources: { de: 'Quellen gesamt', en: 'Total sources' },
    admHealthStorage: { de: 'Speicher', en: 'Storage' },
    admHealthTotalUsers: { de: 'Benutzer gesamt', en: 'Total users' },
    admHealthTotalMessages: { de: 'Nachrichten gesamt', en: 'Total messages' },
    admHealthMessages24h: { de: 'Nachrichten (24 h)', en: 'Messages (24 h)' },
    admHealthViaApi: { de: 'davon {n} über API', en: '{n} of them via API' },
    admHealthQueues: { de: 'Job-Warteschlangen', en: 'Job queues' },
    admHealthSubsystems: { de: 'Subsystem-Status', en: 'Subsystem status' },
    admHealthMainDb: { de: 'Haupt-Datenbank', en: 'Main database' },
    admHealthVectorDb: { de: 'Vektor-Datenbank', en: 'Vector database' },
    admHealthAiProvider: { de: 'KI-Anbieter', en: 'AI provider' },
    admHealthAiProviderNamed: { de: 'KI-Anbieter ({name})', en: 'AI provider ({name})' },
    admHealthTesting: { de: 'Wird getestet …', en: 'Testing…' },
    admHealthNotTested: { de: 'Nicht getestet', en: 'Not tested' },
    admHealthCheck: { de: 'Prüfen', en: 'Check' },
    admHealthCheckFailed: { de: 'Prüfung fehlgeschlagen', en: 'Check failed' },
    admHealthResources: { de: 'Ressourcenverbrauch', en: 'Resource usage' },
    admHealthCpuLoad: { de: 'CPU-Last (1 min)', en: 'CPU load (1m)' },
    admHealthSystemMemory: { de: 'Systemspeicher', en: 'System memory' },
    admHealthNodeHeap: { de: 'Node-Heap ({n} MB)', en: 'Node heap ({n} MB)' },
    admHealthHistory: { de: 'Historische Daten', en: 'Historical data' },
    admHealthRange: { de: 'Zeitraum', en: 'Time range' },
    admHealthStorageUsage: { de: 'Speicherverbrauch', en: 'Storage usage' },
    admHealthSourcesProcessed: { de: 'Quellen verarbeitet (pro Intervall)', en: 'Sources processed (per interval)' },
    admHealthQueueFailures: { de: 'Fehler in Warteschlangen', en: 'Queue failures' },

    // Agent decisions card (AdminAgentMetricsCard)
    admMetricsTitle: { de: 'Agenten-Entscheidungen (live)', en: 'Agent decisions (live)' },
    admMetricsWindow: { de: 'Zeitfenster', en: 'Window' },
    admMetricsAgenticChat: { de: 'Agentischer Chat', en: 'Agentic chat' },
    admMetricsRuns: { de: '{n} Durchläufe', en: '{n} runs' },
    admMetricsToolMix: { de: 'Tool-Mix', en: 'Tool mix' },
    admMetricsDispatches: { de: '{n} Aufrufe', en: '{n} dispatches' },
    admMetricsNoDispatches: { de: 'Noch keine Tool-Aufrufe – der Tool-aware Planner ist aus oder das Zeitfenster ist leer.', en: 'No tool dispatches yet — the tool-aware planner is off, or the window is empty.' },
    admMetricsToolTitle: { de: 'Median {ms} ms · {err} % Fehler', en: 'Median {ms}ms · {err}% errors' },
    admMetricsToolErr: { de: 'Fehler {err} %', en: 'err {err}%' },
    admMetricsMedianHops: { de: 'Median Hops', en: 'Median hops' },
    admMetricsMedianRounds: { de: 'Median Runden', en: 'Median rounds' },
    admMetricsP95Latency: { de: 'P95-Latenz', en: 'P95 latency' },

    // Tools (MCP) section (AdminMCPSection)
    admMcpTitle: { de: 'Werkzeuge (MCP)', en: 'Tools (MCP)' },
    admMcpIntro: {
        de: 'Der Plan-Execute-Orchestrator kann Tool-Aufrufe über die MCP-Registry ausführen: die eingebauten Tools (kb_search, web_search, memory_*) und die unten eingetragenen Remote-MCP-Server.',
        en: 'The plan-execute orchestrator can dispatch tool calls through the MCP registry: the in-process built-ins (kb_search, web_search, memory_*) plus admin-configured remote MCP servers listed below.',
    },
    admMcpUseRegistry: { de: 'Plan-Execute-Suchen über die MCP-Registry leiten (chat_use_mcp_tools)', en: 'Route plan-execute searches through the MCP registry (chat_use_mcp_tools)' },
    admMcpServersLabel: { de: 'Konfigurierte Remote-Server (mcp_servers, JSON-Array)', en: 'Configured remote servers (mcp_servers, JSON array)' },
    admMcpInvalidJson: { de: 'Ungültiges JSON: {error}', en: 'Invalid JSON: {error}' },
    admMcpErrNotArray: { de: 'mcp_servers muss ein JSON-Array sein', en: 'mcp_servers must be a JSON array' },
    admMcpErrEntryObject: { de: 'Jeder Eintrag muss ein Objekt sein', en: 'each entry must be an object' },
    admMcpErrEntryName: { de: 'Jeder Eintrag braucht einen nicht leeren „name"', en: 'each entry needs a non-empty "name"' },
    admMcpErrEntryUrl: { de: 'Jeder Eintrag braucht eine nicht leere „url"', en: 'each entry needs a non-empty "url"' },
    admMcpFormat: { de: 'Format:', en: 'Format:' },
    admMcpServersHelp: { de: 'Speichere das Formular, damit die Liste bleibt; „Registry neu laden" unten wendet sie ohne Neustart an.', en: 'Save the form to persist; click “Reload registry” below to apply without restarting.' },
    admMcpLiveStatus: { de: 'Live-Status', en: 'Live status' },
    admMcpReload: { de: 'Registry neu laden', en: 'Reload registry' },
    admMcpReloadTitle: { de: 'mcp_servers neu aus site_config lesen und auf die laufende Registry anwenden', en: 'Re-read mcp_servers from site_config and apply to the running registry' },
    admMcpApplying: { de: 'Wird angewendet …', en: 'Applying…' },
    admMcpBuiltins: { de: 'Eingebaute Tools ({n})', en: 'Built-in tools ({n})' },
    admMcpRemoteServers: { de: 'Remote-Server ({n})', en: 'Remote servers ({n})' },
    admMcpNoServers: { de: 'Keine Remote-Server konfiguriert.', en: 'No remote servers configured.' },
    admMcpNoTools: { de: 'keine Tools angeboten', en: 'no tools advertised' },
    admMcpReachable: { de: 'erreichbar', en: 'reachable' },
    admMcpUnreachable: { de: 'nicht erreichbar', en: 'unreachable' },

    // Agent tab placeholders (AdminAgentTab)
    admPlaceholderInherit: { de: '(geerbt)', en: '(inherit)' },
    admPlaceholderInheritMinusOne: { de: '-1 (geerbt)', en: '-1 (inherit)' },
    admPlaceholderInheritTopK: { de: '0 (erbt default_top_k)', en: '0 (inherit default_top_k)' },
    admPlaceholderFastTier: { de: '(Fast-Tier-Standard)', en: '(fast-tier default)' },

    // AI model configs (AdminConfigsTab): accessible names of the model rows
    admChatModelN: { de: 'Chat-Modell {n}', en: 'Chat model {n}' },
    admEmbeddingModelN: { de: 'Embedding-Modell {n}', en: 'Embedding model {n}' },
    admEmbeddingDimensionsN: { de: 'Dimensionen für Embedding-Modell {n}', en: 'Dimensions for embedding model {n}' },
    admRerankModelN: { de: 'Rerank-Modell {n}', en: 'Rerank model {n}' },
    admTtsModelN: { de: 'TTS-Modell {n}', en: 'TTS model {n}' },
    admSttModelN: { de: 'STT-Modell {n}', en: 'STT model {n}' },

    // Global topic editor (pages/GlobalKbSettings)
    admAiProvider: { de: 'KI-Anbieter', en: 'AI provider' },
    admChatModel: { de: 'Chat-Modell', en: 'Chat model' },
    admEmbeddingModel: { de: 'Embedding-Modell', en: 'Embedding model' },
    admRerankModel: { de: 'Rerank-Modell', en: 'Rerank model' },
    admTtsModel: { de: 'TTS-Modell', en: 'TTS model' },
    admSyncNow: { de: 'Synchronisieren', en: 'Sync' },
};
