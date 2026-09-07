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
 * Stage 3b (card KI-692) migrated AdminEvalTab and AdminConfigsTab onto it and
 * extended it four times rather than working around it at those call sites:
 * `width="narrow"`, `error`, and SelectFieldRow's `placeholder` + `required`.
 * Each one is documented at its own prop; every later stage inherits them.
 *
 * Card KI-710 then REMOVED `required` again, and this file is otherwise closed
 * (KI-692's reviewer: further changes get their own card). The reason is worth
 * keeping, because it applies to every native validation attribute reachable
 * from here: Radix's Select puts `required` on a VISUALLY HIDDEN native
 * <select>, so a browser that refuses to submit the form has nowhere to show
 * its bubble — Chrome logs "An invalid form control ... is not focusable" and
 * the user sees nothing happen at all. `min`/`max`/`step` on FieldRow's Input
 * are fine, because that control IS focusable; a hidden one is not. Where a
 * select must be filled, the app's own guard validates and the message renders
 * through `error` -> FormMessage below.
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
    FormMessage,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    type InputProps,
} from '@ki4jlu/design-system';

/**
 * The field widths the settings screens use. `default` and `wide` were
 * repeated as an inline `maxWidth` on all 143 rows of AdminAgentTab (135 ×
 * 400px, 8 × 600px); the values are carried over unchanged so the migration is
 * not also a layout change.
 *
 * `narrow` was added by Stage 3b (card KI-692) for the small numeric fields on
 * AdminEvalTab: the four "generate from corpus" counts (raw inputs at 80px)
 * and top-k (a 100px wrapper). 80px is not carried over verbatim because the
 * DS Input brings its own `px-4` (32px of horizontal padding) plus the number
 * spinner, which 80px would clip.
 * TODO: 120px is a reasoned choice, not a measured one — not yet visually
 * confirmed in a browser.
 */
const ROW_WIDTH = {
    default: 'max-w-[400px]',
    wide: 'max-w-[600px]',
    narrow: 'max-w-[120px]',
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
    /**
     * Validation message for this field. Added by Stage 3b (card KI-692):
     * AdminConfigsTab showed its two validation errors as a loose
     * `<span className="field-error" role="alert">` next to the input, with no
     * association to the control at all. The DS already implements the whole
     * wiring — FormItem carries the error, FormLabel turns error-coloured,
     * FormControl sets `aria-invalid` and points `aria-describedby` at
     * FormMessage — so the call site must not re-derive it.
     *
     * Caveat, from the DS FormControl source: when an error is present the
     * control's `aria-describedby` points at the MESSAGE only, so a row that
     * has both `help` and `error` loses the help association while the error
     * is showing. No current call site has both.
     */
    error?: string;
}

/**
 * FormControl points `aria-describedby` at the FormDescription's id (or, with
 * an error, at the FormMessage's) unconditionally. A row that renders neither
 * would leave that reference pointing at nothing — clear it explicitly in that
 * case.
 *
 * TODO: arguably the design system should only set aria-describedby when a
 * FormDescription is present; raised as a DS follow-up, not yet confirmed.
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
 * Label + text/number field + help text. `value`, `onChange`, `type`, `min`,
 * `max`, `step`, `placeholder` and `disabled` pass straight through to the DS
 * Input, so a call site keeps whatever binding it had.
 */
export function FieldRow({
    label,
    help,
    width = 'default',
    footer,
    error,
    ...inputProps
}: FieldRowProps) {
    return (
        <FormItem className={ROW_WIDTH[width]} error={error}>
            <FormLabel>{label}</FormLabel>
            <FormControl {...describedBy(help, error)}>
                <Input {...inputProps} />
            </FormControl>
            {error ? <FormMessage /> : null}
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
    error,
    checked,
    onCheckedChange,
    disabled,
}: CheckboxFieldRowProps) {
    return (
        <FormItem className={ROW_WIDTH[width]} error={error}>
            <div className="flex items-center gap-3">
                <FormControl {...describedBy(help, error)}>
                    <Checkbox
                        checked={checked}
                        onCheckedChange={next => onCheckedChange(next === true)}
                        disabled={disabled}
                    />
                </FormControl>
                <FormLabel className="cursor-pointer">{label}</FormLabel>
            </div>
            {error ? <FormMessage /> : null}
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
    /**
     * Values must be UNIQUE. Not a stylistic rule: Radix renders a hidden
     * native `<option>` per item and keys it by the item's value
     * (@radix-ui/react-select 2.3.7), so two items sharing a value produce a
     * React duplicate-key warning inside the Select and both render as
     * selected. A caller whose source data can repeat a value has to collapse
     * it before passing the list (AdminConfigsTab does).
     */
    options: readonly SelectFieldRowOption[];
    disabled?: boolean;
    /**
     * Trigger text while nothing is selected. Added by Stage 3b (card KI-692):
     * Radix defines "nothing selected" as `value === '' || value === undefined`
     * (`shouldShowPlaceholder`, @radix-ui/react-select 2.3.7), so a screen whose
     * empty string is a MEANINGFUL choice — "fall through to the KB default",
     * "standard, no team" — can only put that wording on the trigger through
     * the placeholder. The option with `value: ''` is still listed, so the
     * choice can be taken back after another value was picked.
     */
    placeholder?: string;
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
    error,
    value,
    onValueChange,
    options,
    disabled,
    placeholder,
}: SelectFieldRowProps) {
    return (
        <FormItem className={ROW_WIDTH[width]} error={error}>
            <FormLabel>{label}</FormLabel>
            <Select value={value} onValueChange={onValueChange} disabled={disabled}>
                <FormControl {...describedBy(help, error)}>
                    <SelectTrigger>
                        <SelectValue placeholder={placeholder} />
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
            {error ? <FormMessage /> : null}
            {help ? <FormDescription>{help}</FormDescription> : null}
            {footer}
        </FormItem>
    );
}
