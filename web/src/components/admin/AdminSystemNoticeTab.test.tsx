import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminSystemNoticeTab from './AdminSystemNoticeTab';
import type { SystemNoticeTemplate } from '../../utils/systemNoticeTemplates';

/* ---------------------------------------------------------------------------
 * The admin's „Systemmeldung" section: type, placement, templates, preview.
 *
 * ORACLE: the site-config record the form writes (what Speichern sends) and
 * the list handed to `onSaveTemplates` (what the template store receives) —
 * not the markup. The preview frame's `data-placement` stands for where the
 * notice is drawn.
 * ------------------------------------------------------------------------- */

const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
const modalMock = { showConfirm: vi.fn(async () => true), showAlert: vi.fn(), showPrompt: vi.fn() };
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => modalMock }));

const NOTICE = {
    system_notice_enabled: 'true',
    system_notice_text: 'Antworten können länger dauern.',
    system_notice_tone: 'warning',
    system_notice_dismissible: 'true',
};

function renderTab(initial: Record<string, string>) {
    let latest = initial;
    const onSaveTemplates = vi.fn<(list: SystemNoticeTemplate[]) => Promise<boolean>>(async () => true);
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    function Harness() {
        const [configs, setConfigs] = useState(initial);
        latest = configs;
        return (
            <AdminSystemNoticeTab
                siteConfigs={configs}
                setSiteConfigs={setConfigs}
                onSubmit={onSubmit}
                onSaveTemplates={onSaveTemplates}
            />
        );
    }
    render(<Harness />);
    return { configs: () => latest, onSaveTemplates, onSubmit };
}

const placementGroup = () => screen.getByRole('radiogroup', { name: 'systemNoticePlacement' });
const previewPlacement = () => document.querySelector('[data-placement]')?.getAttribute('data-placement');

describe('AdminSystemNoticeTab — placement', () => {
    // Nothing stored: the placement follows the type, as users' screens do.
    it('follows the type until the admin picks one', async () => {
        const { configs } = renderTab(NOTICE);
        expect(within(placementGroup()).getByRole('radio', { name: /systemNoticePlacementInline/ })).toBeChecked();
        expect(previewPlacement()).toBe('inline');

        await userEvent.click(screen.getByRole('button', { name: 'systemNoticeToneError' }));
        expect(configs().system_notice_tone).toBe('error');
        expect(within(placementGroup()).getByRole('radio', { name: /systemNoticePlacementBanner/ })).toBeChecked();
        expect(configs().system_notice_placement).toBeUndefined();
    });

    // Clicking the placement the type implies is a choice too: it must be
    // stored, or a later type change would move the notice.
    it('stores a click on the placement the type already implies', async () => {
        const { configs } = renderTab(NOTICE);
        await userEvent.click(within(placementGroup()).getByRole('radio', { name: /systemNoticePlacementInline/ }));
        expect(configs().system_notice_placement).toBe('inline');

        await userEvent.click(screen.getByRole('button', { name: 'systemNoticeToneError' }));
        expect(within(placementGroup()).getByRole('radio', { name: /systemNoticePlacementInline/ })).toBeChecked();
    });

    // The feature: any type in any place — here a warning as the top bar,
    // then as the corner card.
    it('stores the picked placement and draws the preview there', async () => {
        const { configs } = renderTab(NOTICE);
        await userEvent.click(within(placementGroup()).getByRole('radio', { name: /systemNoticePlacementBanner/ }));
        expect(configs().system_notice_placement).toBe('banner');
        expect(configs().system_notice_tone).toBe('warning');
        expect(previewPlacement()).toBe('banner');
        expect(screen.getByText('systemNoticePositionBanner')).toBeInTheDocument();

        await userEvent.click(within(placementGroup()).getByRole('radio', { name: /systemNoticePlacementToast/ }));
        expect(configs().system_notice_placement).toBe('toast');
        expect(previewPlacement()).toBe('toast');
    });
});

describe('AdminSystemNoticeTab — templates', () => {
    it('fills the whole form from a template, placement included, without publishing', async () => {
        const { configs, onSubmit } = renderTab({ ...NOTICE, system_notice_enabled: 'false' });
        await userEvent.click(screen.getByRole('button', { name: 'systemNoticeTemplate' }));
        await userEvent.click(await screen.findByRole('button', { name: /Wartung angekündigt/ }));

        expect(configs()).toMatchObject({
            system_notice_title: 'Wartung angekündigt',
            system_notice_tone: 'warning',
            system_notice_placement: 'banner',
            system_notice_enabled: 'false',
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('saves the current form as a template on Enter, without submitting the notice', async () => {
        const { onSaveTemplates, onSubmit } = renderTab({ ...NOTICE, system_notice_placement: 'toast', system_notice_templates: '[]' });
        await userEvent.click(screen.getByRole('button', { name: 'systemNoticeTemplate' }));
        await userEvent.type(await screen.findByLabelText('systemNoticeTemplateName'), 'Last{Enter}');

        expect(onSubmit).not.toHaveBeenCalled();
        expect(onSaveTemplates).toHaveBeenCalledWith([{
            name: 'Last',
            title: '',
            text: NOTICE.system_notice_text,
            tone: 'warning',
            placement: 'toast',
            dismissible: true,
            linkUrl: '',
            linkLabel: '',
        }]);
    });

    // A notice placed by its tone saves as a template placed by its tone.
    it('saves no placement for a form that follows its tone', async () => {
        const { onSaveTemplates } = renderTab({ ...NOTICE, system_notice_templates: '[]' });
        await userEvent.click(screen.getByRole('button', { name: 'systemNoticeTemplate' }));
        await userEvent.type(await screen.findByLabelText('systemNoticeTemplateName'), 'Auto{Enter}');
        expect(onSaveTemplates.mock.calls[0][0][0].placement).toBe('');
    });

    // The list scrolls inside a popover capped at the room it has, so the
    // save field below it stays reachable with 20 templates.
    it('scrolls the template list and keeps the save field outside it', async () => {
        renderTab(NOTICE);
        await userEvent.click(screen.getByRole('button', { name: 'systemNoticeTemplate' }));
        const list = (await screen.findAllByRole('listitem'))[0].parentElement!;
        expect(list).toHaveClass('overflow-y-auto', 'min-h-0');
        expect(list).not.toContainElement(screen.getByLabelText('systemNoticeTemplateName'));
        expect(list.parentElement!.className).toContain('max-h-[var(--radix-popover-content-available-height)]');
    });

    it('deletes a template after the confirmation', async () => {
        const { onSaveTemplates } = renderTab(NOTICE);
        await userEvent.click(screen.getByRole('button', { name: 'systemNoticeTemplate' }));
        // The mocked `t` drops the name, so every bin has the same label: take the first row's.
        await userEvent.click((await screen.findAllByRole('button', { name: 'systemNoticeTemplateDelete' }))[0]);
        // The five built-in examples, minus the first.
        expect(onSaveTemplates.mock.calls[0][0].map(tpl => tpl.name)).toEqual([
            'Dienst nicht verfügbar', 'Testbetrieb', 'Hohe Auslastung', 'Datenschutzhinweis',
        ]);
    });
});
