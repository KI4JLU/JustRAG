import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import AdminCategoriesSection from './AdminCategoriesSection';
import { translations } from '../../translations';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const tMock = (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
};
const themeMock = { t: tMock };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const modalMock = { showPrompt: vi.fn(), showConfirm: vi.fn() };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toastMock }));
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => modalMock }));

const CATEGORY = { id: 'cat-1', name: 'Verwaltung', sortOrder: 0, colorSlot: 4, color: null };

/*
 * Oracle: the recorded PATCH requests — the admin's pick is what reaches the
 * server, once per pause in picking, and a pick still waiting when the
 * section unmounts (dialog closed, tab switched) is sent rather than dropped.
 */
describe('AdminCategoriesSection colour', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mockedAxios.get.mockResolvedValue({ data: [CATEGORY] });
        mockedAxios.patch.mockImplementation((_url: string, body: unknown) =>
            Promise.resolve({ data: { ...CATEGORY, ...(body as object) } }));
    });
    afterEach(() => { vi.useRealTimers(); });

    const hexField = async () =>
        screen.findByLabelText(`${translations.categoryColorChange.en.replace('{name}', CATEGORY.name)} (Hex)`);

    it('starts from the palette colour of a category without a picked one', async () => {
        render(<AdminCategoriesSection />);
        expect(await hexField()).toHaveValue('#F48B16');
    });

    it('saves a pick once the picking pauses, lowercased', async () => {
        render(<AdminCategoriesSection />);
        const field = await hexField();
        vi.useFakeTimers();
        fireEvent.change(field, { target: { value: '#AA0000' } });
        fireEvent.change(field, { target: { value: '#BB0000' } });
        expect(mockedAxios.patch).not.toHaveBeenCalled();
        await act(async () => { vi.advanceTimersByTime(500); });
        expect(mockedAxios.patch).toHaveBeenCalledTimes(1);
        expect(mockedAxios.patch).toHaveBeenCalledWith(
            expect.stringContaining(`/api/admin/kb-categories/${CATEGORY.id}`),
            { name: CATEGORY.name, sortOrder: CATEGORY.sortOrder, color: '#bb0000' },
        );
    });

    it('saves one pick after another, and the row ends on the last one', async () => {
        let releaseFirst: (v: unknown) => void = () => {};
        mockedAxios.patch
            .mockImplementationOnce((_url: string, body: unknown) =>
                new Promise(resolve => { releaseFirst = () => resolve({ data: { ...CATEGORY, ...(body as object) } }); }))
            .mockImplementation((_url: string, body: unknown) =>
                Promise.resolve({ data: { ...CATEGORY, ...(body as object) } }));
        render(<AdminCategoriesSection />);
        const field = await hexField();
        vi.useFakeTimers();
        fireEvent.change(field, { target: { value: '#AA0000' } });
        await act(async () => { vi.advanceTimersByTime(500); });
        fireEvent.change(field, { target: { value: '#BB0000' } });
        await act(async () => { vi.advanceTimersByTime(500); });
        // The second save waits for the first.
        expect(mockedAxios.patch).toHaveBeenCalledTimes(1);
        await act(async () => { releaseFirst(undefined); });
        expect(mockedAxios.patch).toHaveBeenCalledTimes(2);
        expect(mockedAxios.patch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ color: '#bb0000' }));
        // The first answer arrived late and does not undo the second pick.
        expect(field).toHaveValue('#BB0000');
    });

    it('keeps a rename made while a colour save waits', async () => {
        render(<AdminCategoriesSection />);
        const field = await hexField();
        modalMock.showPrompt.mockResolvedValue('Personal');
        fireEvent.change(field, { target: { value: '#DD0000' } });
        // Rename before the colour save goes out.
        fireEvent.click(screen.getByRole('button', { name: `${translations.edit.en}: ${CATEGORY.name}` }));
        await waitFor(() => expect(mockedAxios.patch).toHaveBeenCalledWith(
            expect.any(String), expect.objectContaining({ name: 'Personal' })));
        // The colour save that follows carries the new name, not the old one.
        await waitFor(() => expect(mockedAxios.patch).toHaveBeenLastCalledWith(
            expect.any(String), { name: 'Personal', sortOrder: CATEGORY.sortOrder, color: '#dd0000' }), { timeout: 2000 });
    });

    it('sends a waiting pick when the section unmounts', async () => {
        const { unmount } = render(<AdminCategoriesSection />);
        const field = await hexField();
        fireEvent.change(field, { target: { value: '#CC0000' } });
        unmount();
        // Sent behind the category's save queue, so a microtask later.
        await waitFor(() => expect(mockedAxios.patch).toHaveBeenCalledWith(
            expect.stringContaining(`/api/admin/kb-categories/${CATEGORY.id}`),
            expect.objectContaining({ color: '#cc0000' }),
        ));
    });
});
