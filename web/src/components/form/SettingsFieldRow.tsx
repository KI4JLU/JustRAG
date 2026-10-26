import * as React from 'react';
import {
    Checkbox,
    Input,
    SettingsRow,
    Textarea,
    type InputProps,
    type TextareaProps,
} from '@ki4jlu/design-system';
import { Choice } from './Choice';

/*
 * The settings-window flavour of the form rows in ./FieldRow (same names, same props), for the
 * admin console: the sign-in page and the text tools keep the framed form look.
 *
 * LAYOUT (developer, 2026-10-26): the rows follow the user settings window. A row is
 * a `SettingsRow` — label and help on the left, the control on the right for a choice
 * (`Choice`, the same ghost dropdown the user settings use), a toggle or a short number,
 * and under the label for a text field or a textarea. The sizes below are the compact
 * ones the settings windows use (the DS nav search does the same: the field has no
 * compact size yet, so the row sets 36px height and 14px text itself).
 */

/** Field widths for the fields that sit under their label. */
const ROW_WIDTH = {
    default: 'max-w-[400px]',
    wide: 'max-w-[600px]',
    narrow: 'max-w-[120px]',
} as const;

type RowWidth = keyof typeof ROW_WIDTH;

interface FieldRowBaseProps {
    /** The field's visible label; also its accessible name. */
    label: React.ReactNode;
    /** Help text next to the label. Wired to the control's aria-describedby. */
    help?: React.ReactNode;
    /** Width of a field that sits under its label. Defaults to 400px. */
    width?: RowWidth;
    /** Extra content below the row (e.g. a conditional warning). */
    footer?: React.ReactNode;
    /**
     * Validation message for this field: shown under the row, announced as an
     * alert, and tied to the control through `aria-invalid` / `aria-describedby`.
     */
    error?: string;
}

/** The ids that tie a row's label, help and error to its control. */
function useRowIds() {
    const base = React.useId();
    return { labelId: `${base}-label`, helpId: `${base}-help`, errorId: `${base}-error` };
}

/** `aria-describedby` for a control: the error while there is one, else the help. */
function describedBy({ helpId, errorId }: { helpId: string; errorId: string }, help: React.ReactNode, error?: string) {
    return error ? errorId : help ? helpId : undefined;
}

function RowHelp({ id, children }: { id: string; children: React.ReactNode }) {
    return children ? <span id={id}>{children}</span> : null;
}

function RowError({ id, error }: { id: string; error?: string }) {
    return error ? <p id={id} role="alert" className="m-0 text-sm text-error">{error}</p> : null;
}

// The compact field the settings rows use; see the note above.
/** The compact single-line field of the settings rows; also for the inputs a form lays out itself. */
export const COMPACT_INPUT = 'h-9 py-0 text-sm';
const COMPACT_TEXTAREA = 'px-3 py-2 text-sm';

export type FieldRowProps = FieldRowBaseProps &
    Omit<
        InputProps,
        | 'id'
        | 'className'
        | 'aria-describedby'
        | 'aria-labelledby'
        | 'aria-invalid'
        | 'children'
        | 'variant'
        | 'leadingIcon'
    >;

/**
 * Label + text/number field + help text. `value`, `onChange`, `type`, `min`,
 * `max`, `step`, `placeholder` and `disabled` pass straight through to the DS
 * Input. A number field (or a `narrow` one) sits on the right of its label like
 * a setting's value; any other field sits under it.
 */
export function FieldRow({ label, help, width = 'default', footer, error, ...inputProps }: FieldRowProps) {
    const ids = useRowIds();
    const inline = inputProps.type === 'number' || width === 'narrow';
    const input = (
        <Input
            {...inputProps}
            className={COMPACT_INPUT}
            aria-labelledby={ids.labelId}
            aria-describedby={describedBy(ids, help, error)}
            aria-invalid={error ? true : undefined}
        />
    );
    return (
        <SettingsRow
            label={label}
            labelId={ids.labelId}
            description={<RowHelp id={ids.helpId}>{help}</RowHelp>}
            control={inline ? <div className="w-32">{input}</div> : undefined}
        >
            {!inline && <div className={`w-full ${ROW_WIDTH[width]}`}>{input}</div>}
            <RowError id={ids.errorId} error={error} />
            {footer}
        </SettingsRow>
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
 * A setting that is on or off, the checkbox on the right of its label.
 *
 * Checkbox, not Switch, on purpose: the value is staged and only takes effect
 * when the surrounding form is submitted. A Switch says "this applies now",
 * which would misrepresent every setting on these screens.
 */
export function CheckboxFieldRow({ label, help, footer, error, checked, onCheckedChange, disabled }: CheckboxFieldRowProps) {
    const ids = useRowIds();
    return (
        <SettingsRow
            label={label}
            labelId={ids.labelId}
            description={<RowHelp id={ids.helpId}>{help}</RowHelp>}
            control={(
                <Checkbox
                    checked={checked}
                    onCheckedChange={next => onCheckedChange(next === true)}
                    disabled={disabled}
                    aria-labelledby={ids.labelId}
                    aria-describedby={describedBy(ids, help, error)}
                    aria-invalid={error ? true : undefined}
                />
            )}
        >
            <RowError id={ids.errorId} error={error} />
            {footer}
        </SettingsRow>
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
     * Trigger text while nothing is selected. Radix defines "nothing selected" as
     * `value === '' || value === undefined`, so a screen whose empty string is a
     * MEANINGFUL choice — "fall through to the KB default" — can only put that
     * wording on the trigger through the placeholder. The option with `value: ''`
     * is still listed, so the choice can be taken back.
     */
    placeholder?: string;
}

/**
 * A setting with a choice: the label on the left, the user settings' `Choice`
 * dropdown on the right.
 */
export function SelectFieldRow({ label, help, footer, error, value, onValueChange, options, disabled, placeholder }: SelectFieldRowProps) {
    const ids = useRowIds();
    return (
        <SettingsRow
            label={label}
            labelId={ids.labelId}
            description={<RowHelp id={ids.helpId}>{help}</RowHelp>}
            control={(
                <Choice
                    id={ids.labelId}
                    value={value}
                    onChange={onValueChange}
                    options={options.map(o => [o.value, o.label] as const)}
                    placeholder={placeholder}
                    disabled={disabled}
                    invalid={Boolean(error)}
                    describedBy={describedBy(ids, help, error)}
                />
            )}
        >
            <RowError id={ids.errorId} error={error} />
            {footer}
        </SettingsRow>
    );
}

export type TextareaFieldRowProps = FieldRowBaseProps &
    Omit<TextareaProps, 'id' | 'className' | 'aria-describedby' | 'aria-labelledby' | 'aria-invalid' | 'children'>;

/** A multi-line FieldRow (the JSON policy editors, the Docling caption prompt, site texts). */
export function TextareaFieldRow({ label, help, width = 'default', footer, error, ...textareaProps }: TextareaFieldRowProps) {
    const ids = useRowIds();
    return (
        <SettingsRow label={label} labelId={ids.labelId} description={<RowHelp id={ids.helpId}>{help}</RowHelp>}>
            <div className={`w-full ${ROW_WIDTH[width]}`}>
                <Textarea
                    {...textareaProps}
                    className={COMPACT_TEXTAREA}
                    aria-labelledby={ids.labelId}
                    aria-describedby={describedBy(ids, help, error)}
                    aria-invalid={error ? true : undefined}
                />
            </div>
            <RowError id={ids.errorId} error={error} />
            {footer}
        </SettingsRow>
    );
}
