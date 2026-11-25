import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ki4jlu/design-system';
import type { SharingRole } from './sharing';

interface SharingRoleSelectProps {
    roles: readonly SharingRole[];
    /** For a visible <Label htmlFor>. */
    id?: string;
    /** Full width of its column instead of the compact row width. */
    wide?: boolean;
    value: string;
    onChange: (role: string) => void;
    /** Accessible name; the trigger shows only the chosen role. */
    label: string;
    t: (k: string) => string;
    disabled?: boolean;
}

/**
 * The role picker used by the invite row, the bulk invite, the invite links and every member
 * row: one DS Select over the roles a person can be given. The options carry no descriptions.
 */
export function SharingRoleSelect({ roles, id, wide, value, onChange, label, t, disabled }: SharingRoleSelectProps) {
    return (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={id} aria-label={label} className={wide ? 'w-full max-w-xs' : 'w-36 shrink-0'}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
                {roles.map(role => (
                    <SelectItem key={role.value} value={role.value}>{t(role.labelKey)}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
