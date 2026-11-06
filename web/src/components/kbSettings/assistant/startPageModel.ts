import type { CSSProperties } from 'react';
import { categoryTone } from '@ki4jlu/design-system';
import type { KbCategory } from '../../../types';
import type { RoleView } from './roleModel';
import { defaultStart, type EntryKind, type EntryStart, type RoleEntry, type StartColors, type StartMode, type StartPage, type Suggestions } from './api';

/**
 * The colour of a catalog category: the one an admin picked (migration 0096),
 * else its fixed palette slot (migration 0093). Both dim in dark mode — the
 * slot through its token, a picked colour through the DS `categoryTone`.
 */
export function categoryDotColor(cat: Pick<KbCategory, 'colorSlot' | 'color'> | null | undefined): string {
    if (cat?.color) return categoryTone(cat.color);
    const slot = cat?.colorSlot && cat.colorSlot >= 1 && cat.colorSlot <= 9 ? cat.colorSlot : 1;
    return `var(--color-category-${slot})`;
}

/**
 * A fine noise tile laid over the glow as dithering: a faint, wide gradient
 * on a dark surface spans only a few 8-bit steps and shows as rings
 * (developer, 30.10.2026: „jagged" in dark mode); the noise breaks them up.
 */
const GLOW_NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.06'/%3E%3C/svg%3E\")";

/** An eased falloff (many stops) instead of a straight ramp, so no edge reads as a ring. */
const GLOW_MASK = 'radial-gradient(ellipse 50% 38% at 50% 48%, black 0%, rgb(0 0 0 / .78) 28%, rgb(0 0 0 / .46) 52%, rgb(0 0 0 / .18) 74%, rgb(0 0 0 / .05) 90%, transparent 100%)';

/**
 * The glow behind the start page's title and composer, in the topic's
 * category colour (as on its cards), masked by an ellipse around the centre
 * of the chat area that fades out well before every edge, so it flows into
 * the page's background with no border on any side. Its strength is
 * `--category-glow-strength` (DS tokens.css): lower in dark mode, where the same
 * tint glares. No category, no glow — the page stays neutral like the topic's
 * card.
 */
export function categoryGlowStyle(cat: Pick<KbCategory, 'colorSlot' | 'color'> | null | undefined): CSSProperties | undefined {
    if (!cat) return undefined;
    const color = categoryDotColor(cat);
    const strength = 'var(--category-glow-strength, 30%)';
    return {
        backgroundImage: `${GLOW_NOISE}, linear-gradient(90deg, color-mix(in oklab, ${color} ${strength}, transparent), color-mix(in oklab, ${color} calc(${strength} * 0.6), transparent))`,
        maskImage: GLOW_MASK,
        WebkitMaskImage: GLOW_MASK,
    };
}

/**
 * The system's cover bands of the start page's role cards, by what the card
 * starts: a chat in the input field (also the KB's original role) a blue
 * fade, a file upload light green into blue, an instruction a warm fade.
 */
export const ROLE_COVER_DEFAULTS: Record<EntryKind, StartColors> = {
    input: { from: '#0B4FB0', to: '#1B3A70' },
    file: { from: '#14B8A6', to: '#7DD3FC' },
    task: { from: '#F59E0B', to: '#F97316' },
};

/** A role card's cover band: a template's own (admin „Bausteine"), else the default for the card's kind. */
export function roleCardCover(role: Pick<RoleView, 'cover'> | undefined, kind: EntryKind): StartColors {
    return role?.cover ?? ROLE_COVER_DEFAULTS[kind];
}

/** A role's colour for its card (`accentColor`): the first of its cover colours. */
export function roleAccent(cover: StartColors): string {
    return cover.from;
}

/** Translation keys of the chat start modes. */
export const START_MODE_LABEL: Record<StartMode, string> = { input: 'asstStartInput', task: 'asstStartTask', upload: 'asstStartUpload', roles: 'asstStartRoles' };

/** The id of the active role's card, always the first. */
export const DEFAULT_ENTRY_ID = 'default';

/** The roles a start falls back to: a template's own start („Vorlagen"). */
export type RoleStarts = readonly { id: string; start?: EntryStart }[];

/** How a role starts when the KB sets up none: its template's start, else the input field. */
export function roleDefaultStart(roles: RoleStarts | undefined, roleId: string): EntryStart {
    return roles?.find(r => r.id === roleId)?.start ?? defaultStart();
}

/** How a role starts its chat: its start set up in „Verhalten", else its template's, else the input field. */
export function startOf(page: StartPage, roleId: string, roles?: RoleStarts): EntryStart {
    return page.roleStarts[roleId] ?? roleDefaultStart(roles, roleId);
}

/**
 * What the start page shows (developer ruling 05.11.2026: how a chat starts
 * is the roles'): „Rollenauswahl" with further role cards, else the active
 * role's start — the input field, its role-prompt card („Anweisung") or its
 * upload area. The server derives the same (kbstartpage.ModeOf).
 */
export function pageMode(page: StartPage, activeRoleId: string, roles?: RoleStarts): StartMode {
    if (page.roleEntries.length > 0) return 'roles';
    const kind = startOf(page, activeRoleId, roles).kind;
    return kind === 'task' ? 'task' : kind === 'file' ? 'upload' : 'input';
}

/** The start prompt the page shows as the active role's card: without further cards, an instruction with text. */
export function activeTaskStart(page: StartPage, activeRoleId: string, roles?: RoleStarts): EntryStart | null {
    if (pageMode(page, activeRoleId, roles) !== 'task') return null;
    const s = startOf(page, activeRoleId, roles);
    return s.text.trim() ? s : null;
}

/** The active role's start as its card: the one card of an „Anweisung" start. */
export function taskModeEntry(start: EntryStart, activeRoleId: string): RoleEntry {
    return { ...start, id: DEFAULT_ENTRY_ID, roleId: activeRoleId };
}

/**
 * `page` with `roleId`'s start set to `next` — dropped back to the default
 * (its template's start, else the input field) when it equals that.
 */
export function withRoleStart(page: StartPage, roleId: string, next: EntryStart, roles?: RoleStarts): StartPage {
    const roleStarts = { ...page.roleStarts };
    if (JSON.stringify(next) === JSON.stringify(roleDefaultStart(roles, roleId))) delete roleStarts[roleId];
    else roleStarts[roleId] = next;
    return { ...page, roleStarts };
}

/** The cards of „Rollenauswahl": the active role's first, then the further ones, each with its role's start. */
export function startEntries(page: StartPage, activeRoleId: string, roles?: RoleStarts): RoleEntry[] {
    return [{ id: DEFAULT_ENTRY_ID, roleId: activeRoleId }, ...page.roleEntries]
        .map(ref => ({ ...startOf(page, ref.roleId, roles), ...ref }));
}

/** A card that cannot start a chat: an instruction without text. */
export function entryIncomplete(e: EntryStart): boolean {
    return e.kind === 'task' && !e.text.trim();
}

/** Speichern waits until every start the page shows is set up: the active role's, and every card's. */
export function chatStartIncomplete(page: StartPage, activeRoleId: string, roles?: RoleStarts): boolean {
    return startEntries(page, activeRoleId, roles).some(entryIncomplete);
}

/** The starter questions under the page's input field: the active role's, when it starts with the input field. */
export function pageQuestions(page: StartPage, activeRoleId: string, roles: RoleStarts | undefined, dynamicQuestions: string[]): string[] {
    if (pageMode(page, activeRoleId, roles) !== 'input') return [];
    return suggestionQuestions(startOf(page, activeRoleId, roles).suggestions, dynamicQuestions);
}

/**
 * Whether an empty chat will show generated questions, so they are worth a
 * model call: a role card's input start, or the page's input-field start
 * (the active role's), each with dynamic questions on.
 */
export function showsGeneratedQuestions(
    roleStart: { kind: string; suggestions?: { questionsOn: boolean; questionMode: string } | null } | null | undefined,
    pageStart: { kind: string; suggestions?: { questionsOn: boolean; questionMode: string } | null } | null,
): boolean {
    const start = roleStart ?? pageStart;
    return !!start && start.kind === 'input' && !!start.suggestions && start.suggestions.questionsOn && start.suggestions.questionMode === 'dynamic';
}

/** The questions a suggestions setting shows: none when off, else the generated ones cut to the count, or the fixed list. */
export function suggestionQuestions(s: (Omit<Suggestions, 'dynamicCount'> & { dynamicCount: number }) | null | undefined, dynamicQuestions: string[]): string[] {
    if (!s || !s.questionsOn) return [];
    return s.questionMode === 'dynamic'
        ? dynamicQuestions.slice(0, s.dynamicCount)
        : s.fixedQuestions.filter(q => q.trim());
}
