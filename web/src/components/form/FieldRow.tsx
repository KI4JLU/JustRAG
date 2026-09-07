/* ---------------------------------------------------------------------------
 * Settings form rows, built on the design system's Form composition.
 *
 * This is the first @ki4jlu/design-system component adoption in this repo
 * (Stufe 1 of the DS migration, board card KI-691). Six more admin/settings
 * screens carry the same row markup — 143 rows in AdminAgentTab.tsx alone, and
 * ~50 more across AdminAuthTab, AdminConfigsTab, AdminSiteTab, AdminSearchTab,
 * AdminEvalTab and SettingsModal — so the composition lives HERE, once, and
 * those screens import it. It is not a pattern to copy.
 *
 * WHAT WAS WRONG WITH THE OLD ROW, and what each of these fixes:
 *
 *   1. The <label> both WRAPPED the control and repeated `htmlFor`. Redundant,
 *      and wrapping is what made a Radix control impossible to drop in. Here
 *      <FormControl> injects the id onto its single child through a Slot and
 *      <FormLabel> reads the same id from context, so the pairing is correct by
 *      construction rather than maintained by hand 143 times. That is also why
 *      `id` is NOT part of any props type below: an explicit id on the child
 *      would win over the injected one and leave FormLabel's htmlFor dangling.
 *      The type makes that mistake unrepresentable.
 *
 *   2. Every row carried a verbatim copy of the same inline style object
 *      (`{ background: 'var(--bg-primary)', border: '1px solid …', … }`) plus a
 *      `maxWidth`. All of it is gone: the look comes from the DS control, and
 *      the only surviving per-row decision is the width, expressed once in
 *      ROW_WIDTH below and selected with `width="wide"`.
 *
 *   3. `.input-group` / `.form-grid` had no CSS rules anywhere in the repo.
 *      Dropped, not carried across.
 *
 * className is deliberately absent from every props type: re-skinning a DS
 * control at the call site is what `design-system/layout-only-classname`
 * exists to prevent, and a row that needs a different look needs a change
 * here (or in the design system), not at one of 143 call sites.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import {
    Checkbox,
    FormControl,
    FormDescription,
    FormItem,
    FormLabel,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    type InputProps,
} from '@ki4jlu/design-system';

/**
 * The two field widths the settings screens use. Previously repeated as an
 * inline `maxWidth` on all 143 rows (135 × 400px, 8 × 600px); the values are
 * carried over unchanged so the migration is not also a layout change.
 */
const ROW_WIDTH = {
    default: 'max-w-[400px]',
    wide: 'max-w-[600px]',
} as const;

type RowWidth = keyof typeof ROW_WIDTH;

interface FieldRowBaseProps {
    /** The field's visible label; also its accessible name via FormLabel. */
    label: React.ReactNode;
    /** Help text under the control. Wired to the control's aria-describedby. */
    help?: React.ReactNode;
    /** `wide` = the old `maxWidth: '600px'` rows. Defaults to 400px. */
    width?: RowWidth;
    /** Extra content below the help text (e.g. a conditional warning). */
    footer?: React.ReactNode;
}

/**
 * FormControl points `aria-describedby` at the FormDescription's id
 * unconditionally. A row with no help text renders no FormDescription, so that
 * reference would point at nothing — clear it explicitly in that case.
 *
 * TODO: arguably the design system should only set aria-describedby when a
 * FormDescription is present; raised as a DS follow-up, not yet confirmed.
 */
function describedBy(help: React.ReactNode) {
    return help ? {} : { 'aria-describedby': undefined };
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
 * Label + text/number field + help text. `value`, `onChange`, `type`, `min`,
 * `max`, `step`, `placeholder` and `disabled` pass straight through to the DS
 * Input, so a call site keeps whatever binding it had.
 */
export function FieldRow({ label, help, width = 'default', footer, ...inputProps }: FieldRowProps) {
    return (
        <FormItem className={ROW_WIDTH[width]}>
            <FormLabel>{label}</FormLabel>
            <FormControl {...describedBy(help)}>
                <Input {...inputProps} />
            </FormControl>
            {help ? <FormDescription>{help}</FormDescription> : null}
            {footer}
        </FormItem>
    );
}

export interface CheckboxFieldRowProps extends FieldRowBaseProps {
    checked: boolean;
    /**
     * Radix reports `boolean | 'indeterminate'`; these rows never set
     * indeterminate, so the wrapper narrows it to a plain boolean.
     */
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
}

/**
 * Checkbox + label on one line, help text underneath.
 *
 * Checkbox, not Switch, on purpose: the value is staged and only takes effect
 * when the surrounding form is submitted. A Switch says "this applies now",
 * which would misrepresent every setting on these screens.
 *
 * The DS Checkbox carries `peer`, and FormLabel carries `peer-disabled:*`, so a
 * disabled row dims its own label — the checkbox has to stay the label's
 * preceding sibling for that to work.
 */
export function CheckboxFieldRow({
    label,
    help,
    width = 'default',
    footer,
    checked,
    onCheckedChange,
    disabled,
}: CheckboxFieldRowProps) {
    return (
        <FormItem className={ROW_WIDTH[width]}>
            <div className="flex items-center gap-3">
                <FormControl {...describedBy(help)}>
                    <Checkbox
                        checked={checked}
                        onCheckedChange={next => onCheckedChange(next === true)}
                        disabled={disabled}
                    />
                </FormControl>
                <FormLabel className="cursor-pointer">{label}</FormLabel>
            </div>
            {help ? <FormDescription>{help}</FormDescription> : null}
            {footer}
        </FormItem>
    );
}

export interface SelectFieldRowOption {
    value: string;
    label: React.ReactNode;
}

export interface SelectFieldRowProps extends FieldRowBaseProps {
    value: string;
    onValueChange: (value: string) => void;
    options: readonly SelectFieldRowOption[];
    disabled?: boolean;
}

/**
 * Label + single-select + help text. Replaces a native `<select>`; the DS
 * Select is a Radix listbox, so it gets Escape, arrow keys and typeahead that
 * the native element only had on some platforms.
 */
export function SelectFieldRow({
    label,
    help,
    width = 'default',
    footer,
    value,
    onValueChange,
    options,
    disabled,
}: SelectFieldRowProps) {
    return (
        <FormItem className={ROW_WIDTH[width]}>
            <FormLabel>{label}</FormLabel>
            <Select value={value} onValueChange={onValueChange} disabled={disabled}>
                <FormControl {...describedBy(help)}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                </FormControl>
                <SelectContent>
                    {options.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {help ? <FormDescription>{help}</FormDescription> : null}
            {footer}
        </FormItem>
    );
}
