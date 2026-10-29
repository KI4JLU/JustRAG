import { BookOpen, Building2, Copy, FileCheck, FileText, GraduationCap, LifeBuoy, PenLine, Sparkles, UserRound, type LucideProps } from 'lucide-react';
import { cn } from '@ki4jlu/design-system';

/** A role's icon by name — the names the backend allows (kbbehavior.knownIcons). */
export function RoleIcon({ name, ...props }: { name?: string } & LucideProps) {
    switch (name) {
        case 'graduation-cap': return <GraduationCap {...props} />;
        case 'book-open': return <BookOpen {...props} />;
        case 'building-2': return <Building2 {...props} />;
        case 'pen-line': return <PenLine {...props} />;
        case 'file-text': return <FileText {...props} />;
        case 'file-check': return <FileCheck {...props} />;
        case 'life-buoy': return <LifeBuoy {...props} />;
        case 'sparkles': return <Sparkles {...props} />;
        case 'copy': return <Copy {...props} />;
        default: return <UserRound {...props} />;
    }
}

/** The square icon field of a role (template: primary, own role: neutral, solid: a role entry). */
export function IconTile({ icon, glyph, tone = 'primary', size = 'md', className }: {
    icon?: string;
    /** Shown instead of the role icon `icon` names (a role card's start mode). */
    glyph?: React.ReactNode;
    tone?: 'primary' | 'neutral' | 'solid';
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'flex shrink-0 items-center justify-center rounded-[var(--ui-radius-tile)]',
                size === 'sm' ? 'size-7 [&_svg]:size-4' : size === 'lg' ? 'size-12 [&_svg]:size-6' : 'size-9 [&_svg]:size-[18px]',
                tone === 'primary' && 'bg-primary-container text-on-primary-container',
                tone === 'neutral' && 'bg-surface-container-high text-on-surface-variant',
                tone === 'solid' && 'bg-primary text-on-primary',
                className,
            )}
        >
            {glyph ?? <RoleIcon name={icon} />}
        </span>
    );
}
