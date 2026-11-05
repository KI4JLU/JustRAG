/**
 * The deployment's names (site_config `assistant_name`, `system_name`): who
 * answers, and the platform it answers on. A role prompt refers to them as
 * `{{assistant_name}}` and `{{system_name}}`; the server fills them in on
 * every answer surface (kbbehavior.Names), the settings' previews do the same
 * here. A blank value is the default.
 */
export interface SystemNames {
    assistant: string;
    system: string;
}

/** The server's defaults (kbbehavior.DefaultAssistantName, DefaultSystemName): keep in sync. */
export const DEFAULT_NAMES: SystemNames = { assistant: 'JLU RAG', system: 'JLU RAG' };

/** The server's limit per name (kbbehavior.MaxNameRunes). */
export const NAME_MAX = 40;

const PLACEHOLDER = /\{\{(assistant_name|system_name)\}\}/g;

/** The names a site config sets, the defaults where it sets none. */
export function namesFromSiteConfig(c: Record<string, string> | undefined): SystemNames {
    return {
        assistant: c?.assistant_name?.trim() || DEFAULT_NAMES.assistant,
        system: c?.system_name?.trim() || DEFAULT_NAMES.system,
    };
}

/**
 * `text` with both placeholders replaced in one pass, as the server does (a
 * name that itself reads `{{system_name}}` stays as written); any other `{{…}}`
 * stays too.
 */
export function resolveNames(text: string, names: SystemNames): string {
    return text.replace(PLACEHOLDER, (_, key: string) => (key === 'assistant_name' ? names.assistant : names.system));
}
