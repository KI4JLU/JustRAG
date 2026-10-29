import axios from 'axios';
import { API_BASE_URL } from '../../../api';
import type { KbCategory } from '../../../types';

/*
 * The assistant's behavior (roles and rules) and start page: the wire types
 * of GET/DELETE /api/kb/{id}/behavior, GET /api/kb-behavior/catalog,
 * GET /api/kb/{id}/start-page and the combined save with its versions,
 * /api/kb/{id}/assistant-settings (API.md "Behavior: roles and rules",
 * "Start page", "Assistant settings and versions"), and the client calls.
 * The AI helpers at the bottom have no backend yet and are marked as such.
 */

/** One of the KB's own roles. `id: "legacy"` is the pre-roles system prompt. */
export interface CustomRole {
    id: string;
    name: string;
    description?: string;
    prompt: string;
    icon?: string;
}

export interface CustomRule {
    id: string;
    text: string;
    on: boolean;
}

/** One role's rules. */
export interface RuleSet {
    /** Catalog rule id → on. A rule missing here is off. */
    rules: Record<string, boolean>;
    customRules: CustomRule[];
}

export interface Behavior {
    version: 1;
    activeRoleId: string;
    customRoles: CustomRole[];
    /**
     * The rules of every role someone set rules for; a role without a set
     * answers with the catalog's defaults, the legacy role with none (rulesFor).
     */
    roleRules: Record<string, RuleSet>;
}

export interface BehaviorSettings {
    behavior: Behavior;
    /** False while the KB still answers from its pre-roles system prompt. */
    customized: boolean;
    /** The language the KB's prompt is compiled in; read the catalog in it. */
    language: 'de' | 'en';
}

export interface CatalogRole {
    id: string;
    name: string;
    description: string;
    prompt: string;
    icon: string;
    isDefault: boolean;
    /** The cover band of its start-page card (admin „Bausteine"); absent = the default by card kind. */
    cover?: StartColors;
    /** Offered for new picks; a disabled template keeps working where it is used. Absent = enabled. */
    enabled?: boolean;
}

export interface CatalogRule {
    id: string;
    label: string;
    description: string;
    text: string;
    defaultOn: boolean;
}

export interface CatalogRuleGroup {
    id: string;
    title: string;
    rules: CatalogRule[];
}

export interface BehaviorCatalog {
    language: 'de' | 'en';
    roles: CatalogRole[];
    ruleGroups: CatalogRuleGroup[];
    rulesHeading: string;
    limits: { promptMax: number; roleNameMax: number; ruleMax: number; customRolesMax: number; customRulesMax: number };
}

export type EntryKind = 'input' | 'task' | 'file';
export type StartMode = 'input' | 'upload' | 'roles';
/** The start page's gradient, `#RRGGBB` each. */
export interface StartColors {
    from: string;
    to: string;
}

/**
 * How a role card starts a chat: the input field (`input`), an instruction
 * sent at once or prefilled (`task`: `text` + `send`), or a file upload
 * (`file`: `text` is the card's label, `instruction` goes with the file; any
 * file a chat attachment takes).
 */
export interface EntryStart {
    kind: EntryKind;
    text: string;
    send: boolean;
    instruction: string;
    /** The suggestions under the input field of the chat an `input` card opens. */
    suggestions: Suggestions;
}

/**
 * Starter questions under an input field (off by default): `dynamic` shows
 * `dynamicCount` of the KB's generated questions, `fixed` the own list. The
 * page's own (flat on StartPage) and every role card's.
 */
export interface Suggestions {
    questionsOn: boolean;
    questionMode: 'dynamic' | 'fixed';
    dynamicCount: 3 | 4 | 6;
    fixedQuestions: string[];
}

export const DEFAULT_SUGGESTIONS: Suggestions = { questionsOn: false, questionMode: 'dynamic', dynamicCount: 4, fixedQuestions: [] };

/** A role's start before it is set up: the input field, suggestions off. */
export const defaultStart = (): EntryStart => ({
    kind: 'input', text: '', send: true, instruction: '', suggestions: { ...DEFAULT_SUGGESTIONS, fixedQuestions: [] },
});

/** A further role card on the page („Rollenauswahl"): picked from the set-up roles. */
export interface RoleEntryRef {
    id: string;
    roleId: string;
}

/** A role card as it shows: the card and how its role starts (`roleStarts`). */
export interface RoleEntry extends RoleEntryRef, EntryStart {}

/** The page's own suggestions (under the input field) are its flat fields. */
export interface StartPage extends Suggestions {
    version: 1;
    /** The glow and the „Entdecken" band; null = no colour. */
    colors: StartColors | null;
    startMode: StartMode;
    /** "" = the default label (t('asstUploadLabelDefault')). */
    uploadLabel: string;
    /** Sent with the file as the first message; "" = the default text. */
    uploadInstruction: string;
    /** How each role set up in „Verhalten" starts its chat, by role id; none = the input field. */
    roleStarts: Record<string, EntryStart>;
    /** The further cards of „Rollenauswahl", after the active role's. */
    roleEntries: RoleEntryRef[];
}

/** GET/PUT /api/kb/{id}/assistant-settings. */
export interface AssistantSettingsResponse {
    title: string;
    description: string | null;
    categoryId: string | null;
    behavior: BehaviorSettings;
    startPage: StartPage;
    startPageConfigured: boolean;
    /** The newest version number, 0 before the first save; sent back as baseVersion. */
    version: number;
    canRename: boolean;
}

export interface AssistantSettingsInput {
    title: string;
    description: string | null;
    categoryId: string | null;
    behavior: Behavior;
    startPage: StartPage;
    baseVersion: number;
}

/** One change of a version against the one before (field codes: API.md). */
export interface VersionChange {
    area: 'start' | 'behavior';
    field: string;
    ref?: string;
    from?: string;
    to?: string;
    added?: string;
    removed?: string;
}

export interface SettingsVersion {
    number: number;
    kind: 'baseline' | 'save' | 'restore';
    createdAt: string;
    authorId: string | null;
    authorName: string;
    note: string | null;
    restoredFrom?: number | null;
    changes: VersionChange[];
}

export const LEGACY_ROLE_ID = 'legacy';
export const ROLE_ENTRY_MAX = 3;
export const FIXED_QUESTION_MAX = 6;
export const QUESTION_MAX_LEN = 120;
export const INSTRUCTION_MAX_LEN = 300;
export const TITLE_MAX_LEN = 80;
export const DESCRIPTION_MAX_LEN = 400;
export const UPLOAD_LABEL_MAX_LEN = 80;

/**
 * The server omits empty role fields (an empty legacy prompt has no `prompt`
 * key) and may send null lists; the UI reads strings and arrays.
 */
function normalizeSettings(s: BehaviorSettings): BehaviorSettings {
    const b = s.behavior;
    return {
        ...s,
        behavior: {
            ...b,
            customRoles: (b.customRoles ?? []).map(r => ({ ...r, name: r.name ?? '', description: r.description ?? '', prompt: r.prompt ?? '' })),
            roleRules: Object.fromEntries(Object.entries(b.roleRules ?? {})
                .map(([id, set]) => [id, { rules: set.rules ?? {}, customRules: set.customRules ?? [] }])),
        },
    };
}

function normalizeAssistant(s: AssistantSettingsResponse): AssistantSettingsResponse {
    return { ...s, behavior: normalizeSettings(s.behavior) };
}

export async function fetchBehavior(kbId: string): Promise<BehaviorSettings> {
    return normalizeSettings((await axios.get<BehaviorSettings>(`${API_BASE_URL}/api/kb/${kbId}/behavior`)).data);
}

/** The footer's „Löschen": no role and no rule, as deleting the system prompt was. */
export async function resetBehavior(kbId: string): Promise<BehaviorSettings> {
    return normalizeSettings((await axios.delete<BehaviorSettings>(`${API_BASE_URL}/api/kb/${kbId}/behavior`)).data);
}

export async function fetchBehaviorCatalog(language: string): Promise<BehaviorCatalog> {
    return (await axios.get<BehaviorCatalog>(`${API_BASE_URL}/api/kb-behavior/catalog`, { params: { lang: language } })).data;
}

/** The start page as members read it (KB view access). */
export async function fetchStartPage(kbId: string): Promise<{ startPage: StartPage; configured: boolean }> {
    return (await axios.get<{ startPage: StartPage; configured: boolean }>(`${API_BASE_URL}/api/kb/${kbId}/start-page`)).data;
}

export async function fetchAssistantSettings(kbId: string): Promise<AssistantSettingsResponse> {
    return normalizeAssistant((await axios.get<AssistantSettingsResponse>(`${API_BASE_URL}/api/kb/${kbId}/assistant-settings`)).data);
}

/** One save of Startseite + Verhalten: one transaction, one version. 409 = changed meanwhile. */
export async function saveAssistantSettings(kbId: string, input: AssistantSettingsInput): Promise<AssistantSettingsResponse> {
    return normalizeAssistant((await axios.put<AssistantSettingsResponse>(`${API_BASE_URL}/api/kb/${kbId}/assistant-settings`, input)).data);
}

export async function fetchSettingsVersions(kbId: string): Promise<SettingsVersion[]> {
    return (await axios.get<{ versions: SettingsVersion[] }>(`${API_BASE_URL}/api/kb/${kbId}/assistant-settings/versions`)).data.versions ?? [];
}

/** Writes version `n`'s state as a new version; nothing is overwritten. */
export async function restoreSettingsVersion(kbId: string, n: number, baseVersion: number): Promise<AssistantSettingsResponse> {
    return normalizeAssistant((await axios.post<AssistantSettingsResponse>(
        `${API_BASE_URL}/api/kb/${kbId}/assistant-settings/versions/${n}/restore`, { baseVersion },
    )).data);
}

export async function fetchCategoryCatalog(): Promise<KbCategory[]> {
    return (await axios.get<KbCategory[]>(`${API_BASE_URL}/api/kb-categories`)).data ?? [];
}

export async function fetchKbCategory(kbId: string): Promise<string | null> {
    const cats = (await axios.get<KbCategory[]>(`${API_BASE_URL}/api/kb/${kbId}/categories`)).data ?? [];
    return cats[0]?.id ?? null;
}

/** Starter questions generated from the KB's documents (cached server-side per KB content). */
export async function fetchStarterQuestions(kbId: string, language: string, roleId?: string): Promise<string[]> {
    return (await axios.get<{ questions: string[] }>(`${API_BASE_URL}/api/kb/${kbId}/starter-questions`, { params: { lang: language, roleId } })).data.questions ?? [];
}

// ---------------------------------------------------------------------------
// AI helpers without a backend yet (ANWEISUNG §4.2). Each is the one place the
// UI calls; replace the body when the endpoint exists.
// ---------------------------------------------------------------------------

/** Thrown by an AI helper whose endpoint does not exist yet. */
export class NotAvailableError extends Error {
    constructor(what: string) {
        super(`${what} is not available yet`);
        this.name = 'NotAvailableError';
    }
}

/** A role writer call; a server without the endpoint (404) reads as not available yet. */
async function roleWriter<T>(kbId: string, action: 'generate' | 'revise' | 'describe', body: object): Promise<T> {
    try {
        return (await axios.post<T>(`${API_BASE_URL}/api/kb/${kbId}/behavior/role-writer/${action}`, body)).data;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) throw new NotAvailableError(`role ${action}`);
        throw err;
    }
}

/** A role — name and prompt — written from a description („Studienberatung für Erstsemester"); `topic`: the KB's name. */
export function generateRolePrompt(kbId: string, description: string, topic: string, language: string): Promise<{ name: string; prompt: string }> {
    return roleWriter(kbId, 'generate', { description, topic, language });
}

/** A role prompt revised by an instruction („kürzer", „ergänze Hinweise zu Fristen"). */
export function reviseRolePrompt(kbId: string, prompt: string, instruction: string, language: string): Promise<{ prompt: string }> {
    return roleWriter(kbId, 'revise', { prompt, instruction, language });
}

/** A role's one-sentence description for its card, written from its name and prompt. */
export function describeRole(kbId: string, name: string, prompt: string, language: string): Promise<{ description: string }> {
    return roleWriter(kbId, 'describe', { name, prompt, language });
}

/**
 * Starter question suggestions for the fixed list. Today these are the KB's
 * generated starter questions (index-based, not role-aware); a role-aware
 * endpoint (planned: `?roleId=`) would replace the call here.
 */
export async function suggestStarterQuestions(kbId: string, language: string): Promise<string[]> {
    return fetchStarterQuestions(kbId, language);
}

/**
 * A description draft written from the topic's title (the editor's, saved or
 * not) and its documents, for the start page editor
 * (POST /api/kb/{id}/description/generate). Nothing is stored: the caller
 * puts it into the draft, and the dialog's save keeps it.
 */
export async function generateDescription(kbId: string, title: string, language: string): Promise<string> {
    return (await axios.post<{ description: string }>(`${API_BASE_URL}/api/kb/${kbId}/description/generate`, { title, language })).data.description;
}
