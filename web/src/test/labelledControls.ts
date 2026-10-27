/**
 * The controls a settings row labels (`aria-labelledby` on the control, the row's label
 * as the target) and the ones whose label names nothing: a dangling IDREF or an empty label.
 * ORACLE for the label/control pairing tests: WAI-ARIA's accessible-name computation, which
 * resolves each IDREF to the element's text.
 */
export function labelledControls(container: ParentNode) {
    const controls = Array.from(container.querySelectorAll('[aria-labelledby]'));
    const broken = controls.flatMap(el => {
        const ids = el.getAttribute('aria-labelledby')!.split(/\s+/).filter(Boolean);
        const name = ids.map(id => container.querySelector(`[id="${CSS.escape(id)}"]`)?.textContent?.trim() ?? '').join('');
        return name ? [] : [`${el.tagName.toLowerCase()} -> #${ids.join(' #')} (names nothing)`];
    });
    return { controls, broken };
}

/** The control a settings row's label names, by the label's text (fast: no scan of every label). */
export function controlByRowLabel(text: string): HTMLElement {
    const label = Array.from(document.querySelectorAll<HTMLElement>('[id$="-label"]')).find(l => l.textContent?.trim() === text);
    if (!label) throw new Error(`no row label "${text}"`);
    const el = document.querySelector<HTMLElement>(`[aria-labelledby~="${CSS.escape(label.id)}"]`);
    if (!el) throw new Error(`label "${text}" names no control`);
    return el;
}
