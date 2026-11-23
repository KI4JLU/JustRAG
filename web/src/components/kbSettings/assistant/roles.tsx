import { BookOpen, Building2, Copy, FileCheck, FileText, GraduationCap, LifeBuoy, PenLine, Sparkles, UserRound, type LucideProps } from 'lucide-react';
import { IconTile as DsIconTile } from '@ki4jlu/design-system';

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

/**
 * The square icon field of a role (template: primary, own role: neutral,
 * solid: a role entry, accent: on a hairline card's rule, in the card's colour)
 * — the DS IconTile with the role's icon as its glyph.
 */
export function IconTile({ icon, glyph, tone = 'primary', size = 'md', className }: {
    icon?: string;
    /** Shown instead of the role icon `icon` names (a role card's start mode). */
    glyph?: React.ReactNode;
    tone?: 'primary' | 'neutral' | 'solid' | 'accent';
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}) {
    return (
        <DsIconTile tone={tone} size={size} className={className}>
            {glyph ?? <RoleIcon name={icon} />}
        </DsIconTile>
    );
}
