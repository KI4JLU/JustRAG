import type { EntryStart, RuleSet } from './api';

/** The own role an editor changes; none = it creates a new one. */
export interface EditTarget {
    roleId: string;
    /** The KB's original role: it may go without a name or prompt. */
    legacy?: boolean;
}

/** The AI help on the role prompt: generate one from a description, or revise the one there is. */
export interface PromptAi {
    query: string;
    phase: 'idle' | 'busy' | 'unavailable' | 'error';
    /** The prompt before the last revision, while it can be undone (until the prompt is edited by hand). */
    undo?: string;
}

/**
 * The role edit screen's working copy: name, description and prompt, the
 * role's own rules and its start on the start page. Nothing reaches the
 * dialog's draft before „Rolle speichern" / „Änderungen übernehmen".
 * - `new`: a new own role (`copyOf`: copied from that template or role).
 * - `edit`: an own role (`editing`).
 * - `template`: a catalog template: its prompt is fixed, its rules and start
 *   are this KB's.
 */
export type RoleEditor = {
    name: string;
    description: string;
    prompt: string;
    rules: RuleSet;
    /** How the role starts on the start page; undefined = the input field. */
    start?: EntryStart;
    ai: PromptAi;
} & (
    | { kind: 'new'; copyOf?: string }
    | { kind: 'edit'; editing: EditTarget }
    | { kind: 'template'; roleId: string }
);

/** The editor's content, as a comparable string: everything but the writer's state. */
export function editorFields(e: RoleEditor): string {
    return JSON.stringify([e.name, e.description, e.prompt, e.rules, e.start ?? null]);
}

/** A role's description limit (the server's MaxRoleDescRunes). */
export const ROLE_DESC_MAX = 200;

export const idleAi: PromptAi = { query: '', phase: 'idle' };

/** The role being edited, if any. */
export const editTarget = (e: RoleEditor): EditTarget | undefined => (e.kind === 'edit' ? e.editing : undefined);

/** Whether „Rolle speichern" / „Änderungen übernehmen" can run. */
export function canSaveEditor(e: RoleEditor): boolean {
    if (e.ai.phase === 'busy') return false;
    if (e.kind === 'template' || editTarget(e)?.legacy) return true;
    return !!e.name.trim() && !!e.prompt.trim();
}
