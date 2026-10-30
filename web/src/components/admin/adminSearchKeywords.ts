import type { AdminSection } from '../../hooks/adminDialog';
import { AGENT_SEARCH_KEYS } from './agentSections';

/*
 * What the admin dialog's search matches besides a section's name: the labels of the fields,
 * groups and columns inside it, so „Top-K", „Google" or „Impressum" find the section that
 * holds them. Translation keys (read in the session language) plus a few fixed words.
 * settingsSearchKeywords.test.ts fails when a settings row's label is missing here.
 */
export const ADMIN_SEARCH_KEYS: Record<AdminSection, readonly string[]> = {
    configs: [
        'provider', 'configName', 'chatModels', 'embeddingModels', 'rerankModels', 'ttsModels', 'sttModels',
        'modelsPerJob', 'modelTierFast', 'cragGraderModel', 'kgExtractionModel', 'contextualEnrichmentModel',
        'chatPlanExecuteModel', 'chatPlanExecuteDAGIterativeModel', 'chatLongmemExtractionModel', 'chatSelfRAGModel', 'raptorSummaryModel',
        'apiKey', 'baseUrl', 'reasoning',
    ],
    auth: [
        'authProviders', 'providerName', 'providerType', 'ldapUrl', 'bindDn', 'bindCredentials', 'searchBaseDn',
        'oidcIssuerUrl', 'oidcClientId', 'oidcClientSecret', 'oidcRedirectUri', 'oidcScopes', 'oidcSuccessRedirect', 'oidcPostLogoutRedirect',
    ],
    search: [
        'webSearchSection', 'academicSearchSection', 'googleSearchApiKey', 'googleSearchCx',
        'academicSearchBaseUrl', 'academicSearchName', 'webSearchEnabled', 'academicSearchEnabled',
    ],
    agent: [...AGENT_SEARCH_KEYS],
    site: [
        'chatFooterLabel', 'kbHeaderLabel', 'imprintLabel', 'examplePromptsLabel', 'webProxy',
        'confluenceSettings', 'confluenceEnabled', 'confluenceBaseUrl', 'gitRepoSettings', 'gitRepoEnabled',
    ],
    'kb-overview': [
        'colName', 'colOwner', 'tabFiles', 'colSuspicious', 'colInjectionFlagged', 'colFailed', 'colSize', 'colActivity',
        'colLastActivity', 'colProcessing', 'colChats', 'colCreated', 'colOldestContent', 'colStaleShare', 'colLastSync', 'colRagas',
    ],
    'global-kbs': ['autoSubscribe', 'unpublishKb'],
    templates: ['tplTabRoles', 'categories', 'tplDefault', 'asstPrompt', 'asstName', 'asstDescription', 'asstColorFrom', 'asstColorTo', 'tplEnabled', 'categoryColor'],
    users: [
        'adminUsersSearch', 'adminUsersFilterRole', 'userInfo', 'roleUser', 'roleApiUser', 'roleAdmin',
        'roleSuperAdmin', 'deleteUser', 'firstName', 'lastName', 'username', 'role', 'userInfoMemberSince', 'userInfoId',
    ],
    roles: [
        'arSystemRolesTitle', 'arKbRolesTitle', 'arMappingTitle', 'arPerTopic',
        'roleUser', 'roleApiUser', 'roleAdmin', 'roleSuperAdmin', 'kbRoleOwner', 'kbRoleAdmin', 'kbRoleEdit', 'kbRoleView',
    ],
    health: ['reembedAllTitle'],
    eval: [
        'evalRunner', 'evalGoldenSets', 'evalGenerateTitle', 'evalGoldenSet', 'evalCompare', 'evalDuration', 'evalHistory',
        'evalGenLookup', 'evalGenComplex', 'evalGenEnumeration', 'evalGenMultiHop', 'evalLabel', 'evalKbId', 'evalTeamLabel', 'evalTopK', 'evalJudge',
    ],
};

/** Words that are not translated: protocol names, queue names, the web/API pair. */
const FIXED_WORDS: Partial<Record<AdminSection, readonly string[]>> = {
    auth: ['LDAP', 'OIDC'],
    'kb-overview': ['Web', 'API'],
    health: ['System Health', 'Queue', 'Redis', 'CPU'],
};

/** The search keywords of every section, in the session language. */
export function adminSectionKeywords(t: (key: string) => string): Record<AdminSection, string[]> {
    const out = {} as Record<AdminSection, string[]>;
    for (const section of Object.keys(ADMIN_SEARCH_KEYS) as AdminSection[]) {
        out[section] = [...ADMIN_SEARCH_KEYS[section].map(t), ...(FIXED_WORDS[section] ?? [])];
    }
    return out;
}
