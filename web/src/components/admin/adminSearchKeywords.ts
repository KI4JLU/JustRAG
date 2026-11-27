import type { AdminSection } from '../../hooks/adminDialog';
import { RIGHT_LABEL_KEY } from '../../utils/kbRoleRights';
import { GLOSSARY_RIGHT_LABEL_KEY } from '../../utils/glossaryRoleRights';
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
        'namesSection', 'institutionNameLabel', 'systemNameLabel', 'assistantNameLabel',
        'confluenceSettings', 'confluenceEnabled', 'confluenceBaseUrl', 'gitRepoSettings', 'gitRepoEnabled',
        'policyAcceptanceSection', 'policyAcceptanceVersion',
    ],
    extensions: ['extensionTranslation', 'translatorEnabled', 'translatorDefaultTargetLanguage', 'translatorModel'],
    notice: [
        'systemNoticeEnabled', 'systemNoticeEdit', 'systemNoticeTone', 'systemNoticePlacement', 'systemNoticeTitle',
        'systemNoticeTemplate', 'systemNoticeText', 'systemNoticeLink', 'systemNoticeLinkUrl', 'systemNoticeLinkLabel',
        'systemNoticeDismissible', 'systemNoticePreview', 'systemNoticeTemplateName',
    ],
    'kb-overview': [
        'colName', 'colOwner', 'kbListColSources', 'colSuspicious', 'colInjectionFlagged', 'colFailed', 'colSize', 'colActivity',
        'colLastActivity', 'colProcessing', 'colChats', 'colCreated', 'colOldestContent', 'colStaleShare', 'colLastSync', 'colRagas',
    ],
    'global-kbs': ['autoSubscribe', 'unpublishKb'],
    templates: ['tplTabRoles', 'categories', 'tplDefault', 'asstPrompt', 'asstName', 'asstDescription', 'tplColor', 'asstRolePromptLayer', 'tplEnabled', 'categoryColor'],
    users: [
        'adminUsersSearch', 'adminUsersFilterRole', 'userInfo', 'roleUser', 'roleApiUser', 'roleAdmin',
        'roleSuperAdmin', 'deleteUser', 'firstName', 'lastName', 'username', 'role', 'userInfoMemberSince', 'userInfoId',
    ],
    roles: [
        'arSystemRolesTitle', 'arKbRolesTitle', 'arGlossaryRolesTitle', 'arMappingTitle', 'arPerTopic',
        'roleUser', 'roleApiUser', 'roleAdmin', 'roleSuperAdmin', 'kbRoleOwner', 'kbRoleAdmin', 'kbRoleEdit', 'kbRoleView',
        // The per-topic rights matrix (read-only here): its row labels.
        ...Object.values(RIGHT_LABEL_KEY),
        // The extension rights and the glossary rights, likewise.
        'arGroupExtensions', 'arRightUseTranslation', ...Object.values(GLOSSARY_RIGHT_LABEL_KEY),
    ],
    health: ['reembedAllTitle'],
    eval: [
        'evalRunner', 'evalGoldenSets', 'evalGenerateTitle', 'evalGoldenSet', 'evalCompare', 'evalDuration', 'evalHistory',
        'evalGenLookup', 'evalGenComplex', 'evalGenEnumeration', 'evalGenMultiHop', 'evalLabel', 'evalKbId', 'evalTopK', 'evalJudge',
    ],
};

/**
 * Words that are not translated: protocol names, queue names, the web/API pair — and the old
 * names of what the admin now reads as „Thema"/„Quelle" (topic/source), so an admin who still
 * searches for „KB", „Knowledge Base" or „Dateien" finds the section.
 */
const OLD_TOPIC_WORDS = ['KB', 'Knowledge Base', 'Wissensdatenbank', 'Wissensbasis', 'Wissensbank'] as const;
const FIXED_WORDS: Partial<Record<AdminSection, readonly string[]>> = {
    auth: ['LDAP', 'OIDC'],
    'kb-overview': ['Web', 'API', ...OLD_TOPIC_WORDS, 'Dateien', 'Files'],
    'global-kbs': [...OLD_TOPIC_WORDS],
    agent: ['KB-Router', 'KB router'],
    health: ['System Health', 'Queue', 'Redis', 'CPU', 'Knowledge Bases', 'Dateien', 'Files'],
};

/** The search keywords of every section, in the session language. */
export function adminSectionKeywords(t: (key: string) => string): Record<AdminSection, string[]> {
    const out = {} as Record<AdminSection, string[]>;
    for (const section of Object.keys(ADMIN_SEARCH_KEYS) as AdminSection[]) {
        out[section] = [...ADMIN_SEARCH_KEYS[section].map(t), ...(FIXED_WORDS[section] ?? [])];
    }
    return out;
}
