import type { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ki4jlu/design-system';

/**
 * A labelled choice for a SettingsRow; the row's label names the select (`id` is
 * the label's `labelId`) or `label` names it. Ghost trigger (value + chevron, no frame): the row
 * already says what it is. The one dropdown of the settings windows — the user
 * settings and the admin console alike.
 */
export function Choice<T extends string>({ id, label, value, onChange, options, placeholder, disabled, invalid, describedBy }: {
    /** The label element that names the choice (a SettingsRow's `labelId`). */
    id?: string;
    /** The name, for a choice with no visible label of its own (a role in a person row). */
    label?: string;
    value: T;
    onChange: (v: T) => void;
    options: readonly (readonly [T, ReactNode])[];
    /** Shown while `value` is '' (nothing chosen). */
    placeholder?: string;
    disabled?: boolean;
    /** The choice failed validation; `describedBy` names the element that says why. */
    invalid?: boolean;
    describedBy?: string;
}) {
    return (
        <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
            <SelectTrigger variant="ghost" aria-labelledby={id} aria-label={id ? undefined : label} aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent align="end">
                {options.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
            </SelectContent>
        </Select>
    );
}
