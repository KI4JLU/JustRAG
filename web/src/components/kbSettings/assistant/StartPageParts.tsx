import { useId } from 'react';
import { ArrowUp, ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import {
    Button, Card, CardBand, CardHairline, Carousel, CarouselContent, CarouselDots, CarouselItem,
    FileDropzone, cn, useCarousel, useCarouselSlides,
} from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { KbCategory } from '../../../types';
import type { EntryKind, RoleEntry, StartColors } from './api';
import { KindIcon } from './entryKinds';
import { IconTile } from './roles';
import type { RoleView } from './roleModel';
import { CategoryPill } from '../../CategoryPill';
import { categoryGlowStyle, roleAccent, roleCardCover } from './startPageModel';

/*
 * The pieces of a KB's start page that the settings' Startseite and the real
 * chat start page (ChatView) share, so the settings show exactly what members
 * see.
 */

/**
 * The start page's colour: a glow in its category's colour that fills the
 * chat area (its parent is `relative isolate`) and shows as a soft ellipse
 * behind the title and the composer, which sit centred there. Filling the
 * parent rather than reaching past it keeps it from ever adding a scrollbar.
 * No category renders nothing; reduced colours (user setting „Farben",
 * `data-colors`) hide it.
 */
export function StartGlow({ category }: { category: Pick<KbCategory, 'colorSlot' | 'color'> | null | undefined }) {
    const style = categoryGlowStyle(category);
    if (!style) return null;
    return <div aria-hidden="true" data-slot="start-glow" className="pointer-events-none absolute inset-0 -z-10 in-data-[colors=reduced]:hidden" style={style} />;
}

/** The title block's frame: no surface of its own, the page's glow shows through. */
export function TitleCardFrame({ className, children }: { className?: string; children: React.ReactNode }) {
    return <div className={cn('relative flex flex-col', className)}>{children}</div>;
}

/** „n Dokumente · Stand <date>" after the category (`leading`: a separator first). */
export function TitleCardMeta({ fileCount, asOf, leading = true }: { fileCount?: number; asOf?: string; leading?: boolean }) {
    const { t, language } = useTheme();
    const date = asOf ? new Date(asOf) : null;
    return (
        <>
            {fileCount !== undefined && (
                <>
                    {leading && <span aria-hidden="true">·</span>}
                    <span>{fileCount === 1 ? t('asstOneDocument') : t('asstNDocuments').replace('{n}', String(fileCount))}</span>
                </>
            )}
            {date && !Number.isNaN(date.getTime()) && (
                <>
                    {(leading || fileCount !== undefined) && <span aria-hidden="true">·</span>}
                    <span>{t('asstAsOf').replace('{date}', date.toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }))}</span>
                </>
            )}
        </>
    );
}

/** The title block as members see it, centred: title, category and meta line, description. */
export function TitleCard({
    title, category, description, fileCount, asOf, action,
}: {
    title: string;
    category: KbCategory | null;
    description: string;
    fileCount?: number;
    asOf?: string;
    /** Top right (the settings' „Bearbeiten"). */
    action?: React.ReactNode;
}) {
    const { t } = useTheme();
    return (
        <TitleCardFrame className={cn(action && 'pr-12 @sm:pr-32')}>
            {action}
            <h2 className="m-0 text-center text-2xl font-semibold leading-tight text-balance break-words hyphens-auto text-on-surface sm:text-3xl">
                {title.trim() || t('asstUntitled')}
            </h2>
            <p className="m-0 mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-on-surface-variant">
                {category && <CategoryPill category={category} />}
                <TitleCardMeta fileCount={fileCount} asOf={asOf} leading={!!category} />
            </p>
            {description && <p className="m-0 mt-3 text-center text-sm leading-6 text-on-surface-variant">{description}</p>}
        </TitleCardFrame>
    );
}

/**
 * A role's head, as a hairline card's top (developer mockup „Rollen-Cards ·
 * Hairline", 30.10.2026): a band tinted in the role's colour with `corner` on
 * its top left (badges), closed by the rule in that colour with the avatar on
 * it showing how the role starts (input field, start prompt or file). The
 * colour is the card's `--card-accent` — set it with `roleAccent` on the card
 * (or the frame) around it. The role card and the role preview share it, so
 * both heads look the same.
 */
export function RoleCover({ kind, corner, compact }: { kind: EntryKind; corner?: React.ReactNode; compact?: boolean }) {
    return (
        <>
            <CardBand className={cn('items-start', compact ? 'min-h-10' : 'min-h-16')}>
                {corner && <span className="flex flex-wrap gap-1">{corner}</span>}
            </CardBand>
            <CardHairline>
                <IconTile glyph={<KindIcon kind={kind} />} tone="accent" className="ring-4 ring-surface-container-lowest" />
            </CardHairline>
        </>
    );
}

/** A role card's size, one everywhere — the start page, its editor and the role overview. */
export const ROLE_CARD_SIZE = 'aspect-[3/4] w-[11.5rem] shrink-0';

/**
 * The inside of a role card: the role's head (RoleCover), then title and
 * description; `children` go below. RoleCardFrame puts it in a Card; the
 * role overview (RoleTile) in a SelectableCard — either with the role's
 * colour as `accentColor` (`roleAccent`).
 */
export function RoleCardBody({
    kind, title, description, corner, children,
}: {
    kind: EntryKind;
    title: React.ReactNode;
    description?: string;
    corner?: React.ReactNode;
    children?: React.ReactNode;
}) {
    return (
        <>
            <RoleCover kind={kind} corner={corner} />
            {/* The fixed size cuts long texts: two lines of title, three of description. */}
            <span className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-5 pb-4">
                <span className="line-clamp-2 shrink-0 text-base font-semibold leading-snug text-balance break-words hyphens-auto text-on-surface">{title}</span>
                {description && <span className="m-0 line-clamp-3 min-h-0 text-sm leading-5 text-on-surface-variant">{description}</span>}
                {children}
            </span>
        </>
    );
}

/**
 * The frame of a role card, shared by the start page and its editor: a Card
 * of ROLE_CARD_SIZE around RoleCardBody.
 * Every card looks alike — the active role's is not singled out. With `onActivate`
 * the whole card is the button (`label` its accessible name).
 */
export function RoleCardFrame({
    cover, kind, title, description, corner, onActivate, label, className, children,
}: {
    cover: StartColors;
    kind: EntryKind;
    title: React.ReactNode;
    description?: string;
    corner?: React.ReactNode;
    onActivate?: () => void;
    label?: string;
    className?: string;
    children?: React.ReactNode;
}) {
    return (
        <Card
            accentColor={roleAccent(cover)}
            className={cn('relative overflow-hidden', ROLE_CARD_SIZE, onActivate && 'cursor-pointer select-none', className)}
            {...(onActivate && {
                interactive: true,
                role: 'button',
                tabIndex: 0,
                'aria-label': label,
                onClick: onActivate,
                onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onActivate();
                    }
                },
            })}
        >
            <RoleCardBody kind={kind} title={title} description={description} corner={corner}>
                {children}
            </RoleCardBody>
        </Card>
    );
}

/** Whether the carousel around the caller has more cards than fit at once. */
function usePaged(): boolean {
    const { canScrollPrev, canScrollNext } = useCarousel();
    const { count, inView } = useCarouselSlides();
    return canScrollPrev || canScrollNext || (inView.length > 0 && inView.length < count);
}

/**
 * „Wähle eine Rolle", centred over the cards; once not all cards fit, with
 * „· 1–3 von 5" and previous/next on the right.
 */
function RoleCarouselHeader({ headingId }: { headingId: string }) {
    const { t } = useTheme();
    const { scrollPrev, scrollNext, canScrollPrev, canScrollNext } = useCarousel();
    const { count, inView } = useCarouselSlides();
    const paged = usePaged();
    return (
        <div className="grid min-h-9 grid-cols-[1fr_auto_1fr] items-center gap-2">
            <h2 id={headingId} className="col-start-2 m-0 text-center text-sm font-medium text-on-surface">
                {t('asstChooseRoleHeading')}
                {paged && (
                    <span className="font-normal text-on-surface-variant">
                        {' · '}
                        {t('asstRoleRange')
                            .replace('{from}', String(inView[0] + 1))
                            .replace('{to}', String(inView[inView.length - 1] + 1))
                            .replace('{count}', String(count))}
                    </span>
                )}
            </h2>
            {paged && (
                <div className="col-start-3 flex items-center justify-end gap-2">
                    <Button variant="outline" size="icon" className="rounded-full" aria-label={t('previousPage')} disabled={!canScrollPrev} onClick={scrollPrev}>
                        <ChevronLeft className="size-4" aria-hidden="true" />
                    </Button>
                    <Button variant="outline" size="icon" className="rounded-full" aria-label={t('nextPage')} disabled={!canScrollNext} onClick={scrollNext}>
                        <ChevronRight className="size-4" aria-hidden="true" />
                    </Button>
                </div>
            )}
        </div>
    );
}

/**
 * The cards keep their one size (RoleCardFrame); as many as fit show, the
 * next peeking in faded. While all fit, auto margins centre the row; once it
 * overflows they resolve to zero, so it starts at the first card.
 */
const ROLE_SLIDE = 'basis-auto first:ml-auto last:mr-auto';
/** Half the 3rem peek, in px: a card scrolled to lands this far in, so the previous one peeks in faded too. */
const PEEK_OFFSET_PX = 24;
/**
 * One card per previous/next and per swipe, each landing on a card's snap
 * point (Embla snaps; `slidesToScroll` 1). A card counts as in view for the
 * „1–3 von 5" range only when mostly visible, not when it merely peeks.
 */
const CAROUSEL_OPTS = { align: () => PEEK_OFFSET_PX, slidesToScroll: 1, inViewThreshold: 0.6 } as const;

/**
 * „Rollenauswahl": one card per role — the active role's first, none
 * preselected or singled out (developer ruling 30.10.2026: once several roles
 * are offered, every card behaves the same) — in a carousel of one, two or three cards per view (by the
 * width it gets), with a counter, previous/next (one card a click) and dots
 * once not all fit. A single role's card stands alone, centred, without the
 * heading: there is nothing to choose.
 * The whole card is the button: it starts a NEW chat in that role (the
 * caller decides how); its avatar shows how — input field, instruction or
 * file.
 */
export function RoleStartCards({
    entries, roles, onStart,
}: {
    entries: RoleEntry[];
    roles: RoleView[];
    onStart: (entry: RoleEntry) => void;
}) {
    const { t } = useTheme();
    const headingId = useId();
    const card = (e: RoleEntry) => {
        const role = roles.find(r => r.id === e.roleId);
        // A card with a start prompt shows the prompt, as the message it
        // sends, in place of the role's description (developer, 05.11.2026).
        const prompt = e.kind === 'task' ? e.text.trim() : '';
        return (
            <RoleCardFrame
                cover={roleCardCover(role, e.kind)}
                kind={e.kind}
                title={role?.name}
                description={prompt ? undefined : role?.description}
                className="transition-colors hover:border-primary"
                onActivate={() => onStart(e)}
                label={`${role?.name ?? ''}: ${prompt || (e.kind === 'file' ? t('asstUploadFile') : e.kind === 'task' ? t('asstGetStarted') : t('asstStartChat'))}`}
            >
                {prompt && <StartPromptQuote text={prompt} lines="line-clamp-4" />}
            </RoleCardFrame>
        );
    };
    // One role leaves nothing to choose (developer, 05.11.2026): its card
    // alone, centred — no „Wähle eine Rolle", no carousel.
    if (entries.length === 1) {
        const [only] = entries;
        // A role that starts with a start prompt: the wide role-prompt card (developer mockup 05.11.2026).
        if (only.kind === 'task' && only.text.trim()) {
            return <RolePromptCard text={only.text.trim()} role={roles.find(r => r.id === only.roleId)} onStart={() => onStart(only)} />;
        }
        return <div className="flex justify-center">{card(only)}</div>;
    }
    return (
        <div className="@container">
            {/* `wheel`: the mouse wheel and the trackpad scroll it too, card by card. */}
            <Carousel aria-labelledby={headingId} opts={CAROUSEL_OPTS} wheel className="flex flex-col gap-3">
                <RoleCarouselHeader headingId={headingId} />
                {/* Faded where more cards lie, so a peeking card fades out instead of ending in a clip. */}
                <CarouselContent fadeEdges>
                    {entries.map(e => (
                        <CarouselItem key={e.id} className={ROLE_SLIDE}>
                            {card(e)}
                        </CarouselItem>
                    ))}
                </CarouselContent>
                <CarouselDots
                    className="mt-2"
                    dotLabel={(n: number, count: number) => t('asstRoleSlide').replace('{n}', String(n + 1)).replace('{count}', String(count))}
                />
            </Carousel>
        </div>
    );
}

/**
 * A role's start prompt, quoted (the marks in the accent colour) and cut to
 * `lines` (a Tailwind line-clamp class).
 */
export function StartPromptQuote({ text, lines }: { text: string; lines: string }) {
    const { t } = useTheme();
    return (
        <span data-testid="start-prompt" className={cn('m-0 min-h-0 break-words italic text-on-surface', lines)}>
            <span aria-hidden="true" className="not-italic font-semibold text-primary">{t('asstQuoteOpen')}</span>
            {text}
            <span aria-hidden="true" className="not-italic font-semibold text-primary">{t('asstQuoteClose')}</span>
        </span>
    );
}

/**
 * The role-prompt card (developer mockup 05.11.2026): a role that starts with
 * a start prompt, alone on the start page („Anweisung", or „Rollenauswahl"
 * with one role). Wide, with the role's head, its name, the prompt quoted and
 * „Klicken zum Starten" with the send arrow; hovering or focusing it lights
 * the border, the line and the arrow. The whole card is the button.
 */
export function RolePromptCard({ text, role, onStart }: {
    text: string;
    role: Pick<RoleView, 'name' | 'cover'> | undefined;
    onStart: () => void;
}) {
    const { t } = useTheme();
    const cover = roleCardCover(role, 'task');
    return (
        <Card
            accentColor={roleAccent(cover)}
            interactive
            role="button"
            tabIndex={0}
            aria-label={`${role?.name ?? ''}: ${text}`}
            onClick={onStart}
            onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onStart();
                }
            }}
            data-testid="role-prompt-card"
            className="group/prompt mx-auto w-full max-w-sm cursor-pointer select-none overflow-hidden transition-[border-color,box-shadow] hover:border-primary hover:ring-4 hover:ring-primary/15 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/25"
        >
            <RoleCover kind="task" compact />
            <span className="flex flex-col gap-1 px-4 pb-3">
                <span className="text-base font-semibold leading-snug text-on-surface">{role?.name}</span>
                <StartPromptQuote text={text} lines="line-clamp-3 text-sm leading-6" />
                <span className="mt-1.5 flex items-center justify-between gap-3">
                    <span className="text-xs text-on-surface-variant transition-colors group-hover/prompt:text-primary group-focus-visible/prompt:text-primary">{t('asstClickToStart')}</span>
                    <span
                        aria-hidden="true"
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface transition-colors group-hover/prompt:bg-primary group-hover/prompt:text-on-primary group-focus-visible/prompt:bg-primary group-focus-visible/prompt:text-on-primary"
                    >
                        <ArrowUp className="size-3.5" />
                    </span>
                </span>
            </span>
        </Card>
    );
}

/**
 * An upload start: the DS dropzone (translucent) with the label. It takes any
 * file a chat attachment takes — the attachment upload refuses the rest, as in
 * the composer.
 */
export function UploadStart({
    title, onFiles, onBrowse, className,
}: {
    title: React.ReactNode;
    onFiles: (files: File[]) => void;
    onBrowse?: () => void;
    className?: string;
}) {
    return (
        <FileDropzone
            onFiles={onFiles}
            onBrowse={onBrowse}
            title={title}
            // See-through, so the start page's glow shows; the accent colour on hover.
            variant="translucent"
            icon={<Upload aria-hidden="true" />}
            className={cn('min-h-40', className)}
        />
    );
}
