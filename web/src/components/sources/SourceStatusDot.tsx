import { cn } from '@ki4jlu/design-system';

export type SourceTone = 'ok' | 'error' | 'busy';

/** A coloured status dot: green done, red failed, amber still running. */
export function SourceStatusDot({ tone }: { tone: SourceTone }) {
    return (
        <span
            aria-hidden="true"
            data-tone={tone}
            className={cn(
                'inline-block size-2 shrink-0 rounded-full',
                tone === 'ok' ? 'bg-success' : tone === 'error' ? 'bg-error' : 'bg-warning',
            )}
        />
    );
}
