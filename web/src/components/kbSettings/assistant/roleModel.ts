import { LEGACY_ROLE_ID, type Behavior, type BehaviorCatalog, type RuleSet, type StartColors } from './api';

/** A role as the settings show it: a catalog template or one of the KB's own. */
export interface RoleView {
    id: string;
    name: string;
    description: string;
    prompt: string;
    icon: string;
    custom: boolean;
    isDefault?: boolean;
    /** The pre-roles system prompt: name fixed, prompt editable. */
    legacy?: boolean;
    /** A template's own cover band (start-page cards); none = the default by card kind. */
    cover?: StartColors;
    /** A template switched off in „Vorlagen": not offered for new picks, kept where it is used. */
    disabled?: boolean;
}

/** Templates first (catalog order), then the KB's own roles. */
export function allRoles(catalog: BehaviorCatalog | null, behavior: Behavior | undefined): RoleView[] {
    const templates: RoleView[] = (catalog?.roles ?? []).map(r => ({
        id: r.id, name: r.name, description: r.description, prompt: r.prompt, icon: r.icon, custom: false, isDefault: r.isDefault,
        cover: r.cover, disabled: r.enabled === false,
    }));
    const own: RoleView[] = (behavior?.customRoles ?? []).map(r => ({
        id: r.id, name: r.name, description: r.description ?? '', prompt: r.prompt, icon: r.icon || 'user-round',
        custom: true, legacy: r.id === LEGACY_ROLE_ID,
    }));
    return [...templates, ...own];
}

/** Per-browser convenience flags; every access may throw (private mode, blocked storage). */
export function readPref(key: string, fallback: boolean): boolean {
    try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v === '1';
    } catch {
        return fallback;
    }
}

export function writePref(key: string, value: boolean): void {
    try {
        localStorage.setItem(key, value ? '1' : '0');
    } catch {
        /* per-viewer convenience only */
    }
}

/** A new client-side id for a role, rule or entry (`[A-Za-z0-9_-]`). */
export function newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The rule set of a role nobody set rules for: the catalog's default rules. */
export function defaultRules(catalog: BehaviorCatalog): RuleSet {
    return { rules: Object.fromEntries(catalog.ruleGroups.flatMap(g => g.rules).map(r => [r.id, r.defaultOn])), customRules: [] };
}

/**
 * The rules a role answers with (the server's RulesFor): a template's are the
 * system preset (the catalog's defaults), fixed; an own role's its set, else
 * the defaults — the legacy role none.
 */
export function rulesFor(catalog: BehaviorCatalog, behavior: Behavior, roleId: string): RuleSet {
    if (catalog.roles.some(r => r.id === roleId)) return defaultRules(catalog);
    const own = behavior.roleRules[roleId];
    if (own) return own;
    return roleId === LEGACY_ROLE_ID ? { rules: {}, customRules: [] } : defaultRules(catalog);
}

/** The texts of a set's switched-on rules: the catalog's, then the own ones. */
export function activeRuleTexts(catalog: BehaviorCatalog, set: RuleSet): string[] {
    return [
        ...catalog.ruleGroups.flatMap(g => g.rules).filter(r => set.rules[r.id]).map(r => r.text),
        ...set.customRules.filter(r => r.on && r.text.trim()).map(r => r.text.trim()),
    ];
}

/** A role's system prompt in the parts the server compiles it from, in its order. */
export interface PromptParts {
    role: string;
    /** „Regeln:" and the active rules as a list; empty without rules. */
    rules: string;
    /** The fixed RAG instructions. */
    tools: string;
}

export function promptParts(rolePrompt: string, ruleTexts: string[], rulesHeading: string, ragPrompt: string): PromptParts {
    return {
        role: rolePrompt,
        rules: ruleTexts.length ? `${rulesHeading}\n${ruleTexts.map(r => `- ${r}`).join('\n')}` : '',
        tools: ragPrompt,
    };
}
