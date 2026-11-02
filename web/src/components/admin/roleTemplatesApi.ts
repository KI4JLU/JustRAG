import axios from 'axios';
import { API_BASE_URL } from '../../api';
import { DEFAULT_SUGGESTIONS, type EntryKind, type EntryStart, type Suggestions } from '../kbSettings/assistant/api';

/** One template text in the two prompt languages; an empty English text falls back to the German one. */
export interface Texts {
    de: string;
    en: string;
}

export type Lang = 'de' | 'en';

/**
 * How a template's chat starts where a topic sets up none of its own: a
 * topic role's start (EntryStart) with its texts in both languages.
 */
export interface TemplateStart {
    kind: EntryKind;
    text: Texts;
    send: boolean;
    instruction: Texts;
    suggestions: Omit<Suggestions, 'fixedQuestions'> & { fixedQuestions: { de: string[]; en: string[] } };
}

/** A role template as „Vorlagen" › Rollen writes it (PUT/POST /api/admin/role-templates). */
export interface TemplateInput {
    /** The language the admin wrote in; the server translates the other one after the save. */
    lang?: Lang;
    /** Stored, not edited: a role card's icon follows how its chat starts (input, upload, task). */
    icon: string;
    isDefault: boolean;
    enabled: boolean;
    name: Texts;
    description: Texts;
    prompt: Texts;
    /** The card colour is `from`; the editor keeps `to` equal to it (one colour per role). */
    cover: { from: string; to: string };
    /** Null = the input field. */
    start: TemplateStart | null;
}

/** As GET lists it: plus its id and how many topics use it. */
export interface RoleTemplate extends TemplateInput {
    id: string;
    usedBy: number;
}

/** The limits the backend applies (kbbehavior.MaxRoleNameRunes, MaxRoleDescRunes, MaxPromptRunes). */
export const TEMPLATE_LIMITS = { name: 80, description: 200, prompt: 8000 } as const;

export const emptyTemplate = (): TemplateInput => ({
    icon: 'sparkles', isDefault: false, enabled: true,
    name: { de: '', en: '' }, description: { de: '', en: '' }, prompt: { de: '', en: '' },
    cover: { from: '#0056B3', to: '#0056B3' }, start: null,
});

export const inputOf = (r: RoleTemplate): TemplateInput => ({
    icon: r.icon, isDefault: r.isDefault, enabled: r.enabled, name: r.name, description: r.description, prompt: r.prompt, cover: r.cover,
    start: r.start ?? null,
});

/** A text in lang; an empty English one shows the German (as topics compile it). */
export const textIn = (t: Texts, lang: Lang) => (lang === 'en' && t.en.trim() ? t.en : t.de);

/** The template's start in lang, as a topic's role start (the input field without one). */
export function startIn(start: TemplateStart | null, lang: Lang): EntryStart {
    if (!start) return { kind: 'input', text: '', send: true, instruction: '', suggestions: { ...DEFAULT_SUGGESTIONS, fixedQuestions: [] } };
    const fq = start.suggestions.fixedQuestions;
    return {
        kind: start.kind, text: textIn(start.text, lang), send: start.send, instruction: textIn(start.instruction, lang),
        suggestions: { ...start.suggestions, fixedQuestions: [...(lang === 'en' && fq.en.length ? fq.en : fq.de)] },
    };
}

/**
 * The template's start with `e` written in lang: the kind and settings are
 * shared, the texts are lang's (the other language's are translated after the
 * save). The plain input field with untouched suggestions is no start of its
 * own; switched-off suggestions keep their questions as a draft.
 */
export function withStart(start: TemplateStart | null, lang: Lang, e: EntryStart): TemplateStart | null {
    const prev = start ?? {
        kind: 'input' as const, text: { de: '', en: '' }, send: true, instruction: { de: '', en: '' },
        suggestions: { ...DEFAULT_SUGGESTIONS, fixedQuestions: { de: [], en: [] } },
    };
    const next: TemplateStart = {
        kind: e.kind, send: e.send,
        text: { ...prev.text, [lang]: e.text },
        instruction: { ...prev.instruction, [lang]: e.instruction },
        suggestions: { ...e.suggestions, fixedQuestions: { ...prev.suggestions.fixedQuestions, [lang]: e.suggestions.fixedQuestions } },
    };
    const s = next.suggestions;
    const plain = next.kind === 'input' && !s.questionsOn && s.questionMode === DEFAULT_SUGGESTIONS.questionMode
        && s.dynamicCount === DEFAULT_SUGGESTIONS.dynamicCount && !s.fixedQuestions.de.length && !s.fixedQuestions.en.length
        && !next.text.de && !next.text.en && !next.instruction.de && !next.instruction.en;
    return plain ? null : next;
}

/** Whether „Speichern" can run: the backend's required fields, in the written language. */
export const canSaveTemplate = (t: TemplateInput, lang: Lang) =>
    !!textIn(t.name, lang).trim() && !!textIn(t.prompt, lang).trim() && !(t.start?.kind === 'task' && !textIn(t.start.text, lang).trim());

const base = `${API_BASE_URL}/api/admin/role-templates`;

// Every write answers with the whole list, in display order.
export const listTemplates = async () => (await axios.get<RoleTemplate[]>(base)).data;
export const createTemplate = async (t: TemplateInput) => (await axios.post<RoleTemplate[]>(base, t)).data;
export const updateTemplate = async (id: string, t: TemplateInput) => (await axios.put<RoleTemplate[]>(`${base}/${encodeURIComponent(id)}`, t)).data;
export const deleteTemplate = async (id: string) => (await axios.delete<RoleTemplate[]>(`${base}/${encodeURIComponent(id)}`)).data;
export const reorderTemplates = async (ids: string[]) => (await axios.put<RoleTemplate[]>(`${base}/order`, { ids })).data;
