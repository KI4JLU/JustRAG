/* ---------------------------------------------------------------------------
 * The framed form row of the sign-in page, built on the design system's Form
 * composition. The settings windows use the rows in ./SettingsFieldRow instead.
 *
 * <FormControl> injects the id onto its single child through a Slot and
 * <FormLabel> reads the same id from context, so label and control pair by
 * construction. That is why `id` is not part of the props type: an explicit id
 * on the child would win over the injected one and leave FormLabel's htmlFor
 * dangling.
 *
 * className is deliberately absent from the props type: re-skinning a DS
 * control at the call site is what `design-system/layout-only-classname`
 * exists to prevent.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import {
    FormControl,
    FormDescription,
    FormItem,
    FormLabel,
    FormMessage,
    Input,
    type InputProps,
} from '@ki4jlu/design-system';

interface FieldRowBaseProps {
    /** The field's visible label; also its accessible name via FormLabel. */
    label: React.ReactNode;
    /** Help text under the control. Wired to the control's aria-describedby. */
    help?: React.ReactNode;
    /**
     * Validation message for this field. FormItem carries it, FormLabel turns
     * error-coloured, FormControl sets `aria-invalid` and points
     * `aria-describedby` at FormMessage. While an error shows, the help text
     * loses its aria-describedby association.
     */
    error?: string;
}

/**
 * FormControl points `aria-describedby` at the FormDescription's id (or, with
 * an error, at the FormMessage's) unconditionally. A row that renders neither
 * would leave that reference pointing at nothing, so it is cleared then.
 */
function describedBy(help: React.ReactNode, error?: string) {
    return help || error ? {} : { 'aria-describedby': undefined };
}

export type FieldRowProps = FieldRowBaseProps &
    Omit<
        InputProps,
        | 'id'
        | 'className'
        | 'aria-describedby'
        | 'aria-invalid'
        | 'children'
        | 'variant'
        | 'leadingIcon'
    >;

/**
 * Label + field + help text. Every other prop (`value`, `onChange`, `type`,
 * `placeholder`, `autoComplete`, …) passes straight through to the DS Input.
 */
export function FieldRow({ label, help, error, ...inputProps }: FieldRowProps) {
    return (
        <FormItem className="max-w-[400px]" error={error}>
            <FormLabel>{label}</FormLabel>
            <FormControl {...describedBy(help, error)}>
                <Input {...inputProps} />
            </FormControl>
            {error ? <FormMessage /> : null}
            {help ? <FormDescription>{help}</FormDescription> : null}
        </FormItem>
    );
}
