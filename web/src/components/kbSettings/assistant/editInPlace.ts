/*
 * Proposed design-system pattern (edit in place): a field that keeps the
 * look of the page it sits on, marked as editable by a dashed outline in
 * currentColor — so it works on every gradient and without one.
 */
export const editableField =
    'w-full resize-none border-0 bg-transparent p-0 [field-sizing:content] rounded-[var(--ui-radius-control)] outline-1 outline-offset-4 outline-dashed outline-current/30 transition-[outline-color] hover:outline-current/60 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-current placeholder:text-current placeholder:opacity-60';

export const inlineSelectTrigger =
    'h-auto w-auto gap-1 rounded-full border-0 bg-transparent py-0 pl-1.5 pr-0.5 -ml-1.5 text-[length:inherit] leading-[inherit] text-current shadow-none outline-1 outline-dashed outline-transparent hover:outline-current/40 [&>svg]:size-3.5 [&>svg]:text-current [&>svg]:opacity-100';
