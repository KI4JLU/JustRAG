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

/** The colours as a gradient: the picker's swatch and the „Entdecken" card's band. */
export function colorsStyle(colors: StartColors | null | undefined): CSSProperties | undefined {
    return colors ? { backgroundImage: `linear-gradient(120deg, ${colors.from}, ${colors.to})` } : undefined;
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
