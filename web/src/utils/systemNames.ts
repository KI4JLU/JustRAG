import { appNameFrom } from './appName';

/**
 * The deployment's names (site_config `assistant_name`, `institution_name`,
 * `system_name`): who answers, and the platform it answers on — the app
 * name's two parts („JLU [RAG]", appName.ts). A role prompt refers to them as
 * `{{assistant_name}}`, `{{institution_name}}` and `{{system_name}}`; the
 * server fills them in on every answer surface (kbbehavior.Names), the
 * settings' previews do the same here. A blank value is the default.
 */
export interface SystemNames {
    assistant: string;
    institution: string;
    system: string;
}

/**
 * The server's shipped defaults (kbbehavior.DefaultAssistantName,
 * DefaultInstitutionName, DefaultSystemName): keep in sync. A deployment's
 * institution and system default to its APP_NAME_PREFIX / APP_NAME_PRODUCT
 * instead (namesFromSiteConfig), as on the server.
 */
export const DEFAULT_NAMES: SystemNames = { assistant: 'JLU RAG', institution: 'JLU', system: 'RAG' };

/** The server's limit per name (kbbehavior.MaxNameRunes). */
export const NAME_MAX = 40;

const PLACEHOLDER = /\{\{(assistant_name|institution_name|system_name)\}\}/g;

/** The names a site config sets; the defaults where it sets none. */
export function namesFromSiteConfig(c: Record<string, string> | undefined): SystemNames {
    const { prefix, product } = appNameFrom(c);
    return {
        assistant: c?.assistant_name?.trim() || DEFAULT_NAMES.assistant,
        institution: prefix,
        system: product,
    };
}

/**
 * `text` with the placeholders replaced in one pass, as the server does (a
 * name that itself reads `{{system_name}}` stays as written); any other `{{…}}`
 * stays too.
 */
export function resolveNames(text: string, names: SystemNames): string {
    return text.replace(PLACEHOLDER, (_, key: string) =>
        key === 'assistant_name' ? names.assistant : key === 'institution_name' ? names.institution : names.system);
}
