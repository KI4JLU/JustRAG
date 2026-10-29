import type { CSSProperties } from 'react';
import type { KbCategory } from '../../../types';
import type { RoleView } from './roleModel';
import { defaultStart, type EntryKind, type EntryStart, type RoleEntry, type StartColors, type StartMode, type StartPage, type Suggestions } from './api';

/** The colour of a catalog category: its fixed palette slot (migration 0093). */
export function categoryDotColor(cat: Pick<KbCategory, 'colorSlot'> | null | undefined): string {
    const slot = cat?.colorSlot && cat.colorSlot >= 1 && cat.colorSlot <= 9 ? cat.colorSlot : 1;
    return `var(--color-category-${slot})`;
}

/** The colours of a KB that never chose its own (kbstartpage.DefaultColors). */
export const DEFAULT_COLORS: StartColors = { from: '#0056B3', to: '#3897E8' };

/** The colours as a gradient: the picker's swatch and the „Entdecken" card's band. */
export function colorsStyle(colors: StartColors | null | undefined): CSSProperties | undefined {
    return colors ? { backgroundImage: `linear-gradient(120deg, ${colors.from}, ${colors.to})` } : undefined;
}

/**
 * The glow behind the start page's title and composer: the two colours side
 * by side, masked by an ellipse around the centre of the chat area that
 * reaches transparent well before every edge, so it flows into the page's
 * background with no border on any side. The colours are the author's own
 * hex values, so the same in light and dark mode; the low tint keeps the
 * surface's text readable on either.
 */
export function colorsGlowStyle(colors: StartColors | null | undefined): CSSProperties | undefined {
    if (!colors) return undefined;
    const tint = (color: string) => `color-mix(in oklab, ${color} 28%, transparent)`;
    const mask = 'radial-gradient(ellipse 46% 34% at 50% 48%, black, transparent)';
    return { backgroundImage: `linear-gradient(90deg, ${tint(colors.from)}, ${tint(colors.to)})`, maskImage: mask, WebkitMaskImage: mask };
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

/** Translation keys of the chat start modes. */
export const START_MODE_LABEL: Record<StartMode, string> = { input: 'asstStartInput', upload: 'asstStartUpload', roles: 'asstStartRoles' };

/** The id of the active role's card, always the first. */
export const DEFAULT_ENTRY_ID = 'default';

/** How a role starts its chat: its start set up in „Verhalten", else the input field. */
export function startOf(page: StartPage, roleId: string): EntryStart {
    return page.roleStarts[roleId] ?? defaultStart();
}

/** The cards of „Rollenauswahl": the active role's first, then the further ones, each with its role's start. */
export function startEntries(page: StartPage, activeRoleId: string): RoleEntry[] {
    return [{ id: DEFAULT_ENTRY_ID, roleId: activeRoleId }, ...page.roleEntries]
        .map(ref => ({ ...startOf(page, ref.roleId), ...ref }));
}

/** A card that cannot start a chat: an instruction without text. */
export function entryIncomplete(e: EntryStart): boolean {
    return e.kind === 'task' && !e.text.trim();
}

/** Speichern waits until the chosen chat start is fully set up. */
export function chatStartIncomplete(page: StartPage, activeRoleId: string): boolean {
    // A choice needs two roles; with the active role alone the input field starts the same chat.
    if (page.startMode === 'roles') return page.roleEntries.length === 0 || startEntries(page, activeRoleId).some(entryIncomplete);
    return false;
}

/** What members see of the starter questions: none unless on and in the input-field start. */
export function visibleQuestions(page: StartPage | null | undefined, dynamicQuestions: string[]): string[] {
    if (!page || page.startMode !== 'input') return [];
    return suggestionQuestions(page, dynamicQuestions);
}

/**
 * Whether an empty chat will show generated questions, so they are worth a
 * model call: a role card's input start, a configured input start or the
 * default start page — each with dynamic questions on. `page` is the
 * configured start page (null = the default one).
 */
export function showsGeneratedQuestions(
    roleStart: { kind: string; suggestions?: { questionsOn: boolean; questionMode: string } | null } | null | undefined,
    page: StartPage | null,
): boolean {
    const dynamic = (s: { questionsOn: boolean; questionMode: string } | null | undefined) => !!s && s.questionsOn && s.questionMode === 'dynamic';
    if (roleStart) return roleStart.kind === 'input' && dynamic(roleStart.suggestions);
    if (page) return page.startMode === 'input' && dynamic(page);
    return true;
}

/** The questions a suggestions setting shows: none when off, else the generated ones cut to the count, or the fixed list. */
export function suggestionQuestions(s: (Omit<Suggestions, 'dynamicCount'> & { dynamicCount: number }) | null | undefined, dynamicQuestions: string[]): string[] {
    if (!s || !s.questionsOn) return [];
    return s.questionMode === 'dynamic'
        ? dynamicQuestions.slice(0, s.dynamicCount)
        : s.fixedQuestions.filter(q => q.trim());
}
