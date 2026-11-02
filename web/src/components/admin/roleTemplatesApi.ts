import axios from 'axios';
import { API_BASE_URL } from '../../api';

/** One template text in the two prompt languages; an empty English text falls back to the German one. */
export interface Texts {
    de: string;
    en: string;
}

/** A role template as „Vorlagen" › Rollen writes it (PUT/POST /api/admin/role-templates). */
export interface TemplateInput {
    icon: string;
    isDefault: boolean;
    enabled: boolean;
    name: Texts;
    description: Texts;
    prompt: Texts;
    cover: { from: string; to: string };
}

/** As GET lists it: plus its id and how many topics use it. */
export interface RoleTemplate extends TemplateInput {
    id: string;
    usedBy: number;
}

/** The icons the backend accepts (kbbehavior.knownIcons), in picker order. */
export const TEMPLATE_ICONS = [
    'graduation-cap', 'book-open', 'building-2', 'pen-line', 'file-text', 'file-check', 'life-buoy', 'sparkles', 'user-round', 'copy',
] as const;

/** The limits the backend applies (kbbehavior.MaxRoleNameRunes, MaxRoleDescRunes, MaxPromptRunes). */
export const TEMPLATE_LIMITS = { name: 80, description: 200, prompt: 8000 } as const;

export const emptyTemplate = (): TemplateInput => ({
    icon: 'sparkles', isDefault: false, enabled: true,
    name: { de: '', en: '' }, description: { de: '', en: '' }, prompt: { de: '', en: '' },
    cover: { from: '#0056B3', to: '#3897E8' },
});

export const inputOf = (r: RoleTemplate): TemplateInput => ({
    icon: r.icon, isDefault: r.isDefault, enabled: r.enabled, name: r.name, description: r.description, prompt: r.prompt, cover: r.cover,
});

/** Whether „Speichern" can run: the backend's required fields. */
export const canSaveTemplate = (t: TemplateInput) => !!t.name.de.trim() && !!t.prompt.de.trim();

const base = `${API_BASE_URL}/api/admin/role-templates`;

// Every write answers with the whole list, in display order.
export const listTemplates = async () => (await axios.get<RoleTemplate[]>(base)).data;
export const createTemplate = async (t: TemplateInput) => (await axios.post<RoleTemplate[]>(base, t)).data;
export const updateTemplate = async (id: string, t: TemplateInput) => (await axios.put<RoleTemplate[]>(`${base}/${encodeURIComponent(id)}`, t)).data;
export const deleteTemplate = async (id: string) => (await axios.delete<RoleTemplate[]>(`${base}/${encodeURIComponent(id)}`)).data;
export const reorderTemplates = async (ids: string[]) => (await axios.put<RoleTemplate[]>(`${base}/order`, { ids })).data;
