import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import AdminTemplatesTab from './AdminTemplatesTab';
import { translations } from '../../translations';
import type { RoleTemplate } from './roleTemplatesApi';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const tMock = (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
};
const themeMock = { t: tMock, language: 'en' };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const modalMock = { showPrompt: vi.fn(), showConfirm: vi.fn(async () => true) };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toastMock }));
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => modalMock }));
// ColorField is newer than the pinned DS the tests resolve.
vi.mock('@ki4jlu/design-system', async (importOriginal) => ({
    ...await importOriginal<typeof import('@ki4jlu/design-system')>(),
    ColorField: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
        // eslint-disable-next-line design-system/no-raw-ui-elements -- a test stand-in for the DS ColorField
        <input aria-label={label} value={value} onChange={e => onChange(e.target.value)} />
    ),
}));

const role = (patch: Partial<RoleTemplate>): RoleTemplate => ({
    id: 'r', icon: 'sparkles', isDefault: false, enabled: true, usedBy: 0,
    name: { de: 'Rolle', en: '' }, description: { de: '', en: '' }, prompt: { de: 'P', en: '' },
    cover: { from: '#112233', to: '#445566' }, ...patch,
});

let list: RoleTemplate[];

beforeEach(() => {
    vi.clearAllMocks();
    list = [
        role({ id: 'research', isDefault: true, name: { de: 'Forschungsassistent', en: 'Research assistant' }, usedBy: 3 }),
        role({ id: 'tutor', name: { de: 'Tutor', en: '' }, usedBy: 1 }),
        role({ id: 't-1', name: { de: 'Neu', en: '' } }),
    ];
    mockedAxios.get.mockImplementation(async (url: string) => ({ data: url.includes('role-templates') ? list : [] }));
    mockedAxios.put.mockImplementation(async () => ({ data: list }));
});

function renderTab() {
    const footer = document.createElement('div');
    document.body.appendChild(footer);
    render(<AdminTemplatesTab footerSlot={footer} />);
    return footer;
}

// Oracle: developer ruling 28.10.2026 — the default roles are defined in the
// admin console („Vorlagen"), with their cover colours; a role topics use can
// only be disabled, not deleted.
describe('AdminTemplatesTab', () => {
    it('lists the roles in the session language, the default and the use count', async () => {
        renderTab();
        expect(await screen.findByText('Research assistant')).toBeInTheDocument();
        // No English name: the German one.
        expect(screen.getByText('Tutor')).toBeInTheDocument();
        expect(screen.getByText('Default role')).toBeInTheDocument();
        expect(screen.getByText('Used in 3 topics')).toBeInTheDocument();
    });

    it('cannot delete a role topics use, but can delete an unused one', async () => {
        renderTab();
        await userEvent.click(await screen.findByRole('button', { name: 'Actions for Tutor' }));
        expect(await screen.findByRole('menuitem', { name: /Delete \(in use\)/ })).toHaveAttribute('data-disabled');
        await userEvent.keyboard('{Escape}');
        mockedAxios.delete.mockResolvedValue({ data: list.slice(0, 2) });
        await userEvent.click(screen.getByRole('button', { name: 'Actions for Neu' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: /^delete$/i }));
        await waitFor(() => expect(mockedAxios.delete).toHaveBeenCalledWith(expect.stringContaining('/api/admin/role-templates/t-1')));
    });

    it('edits a role and saves it with its English text and colours', async () => {
        const footer = renderTab();
        await userEvent.click(await screen.findByRole('button', { name: 'Actions for Tutor' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: /^edit$/i }));
        await userEvent.click(screen.getByRole('button', { name: 'English' }));
        await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Tutor EN');
        await userEvent.clear(screen.getByLabelText('Start colour'));
        await userEvent.type(screen.getByLabelText('Start colour'), '#ABCDEF');
        await userEvent.click(screen.getByRole('radio', { name: 'Book' }));
        const save = Array.from(footer.querySelectorAll('button')).find(b => b.textContent?.includes('Save'));
        await userEvent.click(save!);
        await waitFor(() => expect(mockedAxios.put).toHaveBeenCalled());
        const [url, body] = mockedAxios.put.mock.calls[0] as [string, RoleTemplate];
        expect(url).toContain('/api/admin/role-templates/tutor');
        expect(body).toMatchObject({ name: { de: 'Tutor', en: 'Tutor EN' }, cover: { from: '#ABCDEF' }, icon: 'book-open' });
        expect(body).not.toHaveProperty('usedBy');
    });
});
