import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { AdminHarness } from './test/AdminHarness';

/* ---------------------------------------------------------------------------
 * Saving the system notice sends only the fields edited in this dialog.
 *
 * An automation job (PUT /api/v1/system-notice) or another admin may change
 * the notice while the dialog is open; a full snapshot would silently revert
 * that. ORACLE: the body of the PUT the dialog sends.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

// Stable objects: `t` and `toast` sit in AdminUI's fetch dependency lists.
const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('./contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('./contexts/ToastContext', () => ({ useToast: () => toastMock }));
const modalMock = { showConfirm: vi.fn(), showAlert: vi.fn(), showPrompt: vi.fn() };
vi.mock('./contexts/ModalContext', () => ({ useModalContext: () => modalMock }));
const authMock = { user: { id: 'op-1', role: 'admin' } };
vi.mock('./contexts/AuthContext', () => ({ useAuth: () => authMock }));
vi.mock('./hooks/useReducedMotion', () => ({ useReducedMotion: () => false, getMotionProps: () => ({}) }));

const STORED = {
    system_notice_enabled: 'true',
    system_notice_title: 'Hohe Auslastung',
    system_notice_text: 'Antworten können länger dauern.',
    system_notice_tone: 'warning',
    system_notice_dismissible: 'true',
};

const mockedGet = axios.get as unknown as Mock;
const mockedPut = axios.put as unknown as Mock;

beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockImplementation((url: string) =>
        Promise.resolve({ data: String(url).includes('/site-config') ? STORED : [] }));
    mockedPut.mockResolvedValue({ data: {} });
});

describe('AdminUI — system notice save', () => {
    it('sends only the edited field', async () => {
        render(<AdminHarness userRole="admin" section="notice" />);
        const title = await screen.findByDisplayValue('Hohe Auslastung');
        await userEvent.clear(title);
        await userEvent.type(title, 'Wartung');
        await userEvent.click(screen.getByRole('button', { name: /saveSettings|settingsSave|speichern/i }));

        expect(mockedPut).toHaveBeenCalledTimes(1);
        expect(mockedPut.mock.calls[0][1]).toEqual({ configs: { system_notice_title: 'Wartung' } });
    });

    it('sends nothing when nothing was edited', async () => {
        render(<AdminHarness userRole="admin" section="notice" />);
        await screen.findByDisplayValue('Hohe Auslastung');
        await userEvent.click(screen.getByRole('button', { name: /saveSettings|settingsSave|speichern/i }));

        expect(mockedPut).not.toHaveBeenCalled();
        expect(toastMock.success).toHaveBeenCalled();
    });
});
