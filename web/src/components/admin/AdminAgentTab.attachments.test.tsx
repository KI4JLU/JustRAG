import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import AdminAgentTab from './AdminAgentTab';
import { translations } from '../../translations';

const tMock = (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
};
const themeMock = { t: tMock };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true, getMotionProps: () => ({}) }));
vi.mock('./AdminAgentMetricsCard', () => ({ default: () => null }));
vi.mock('./AdminMCPSection', () => ({ default: () => null }));
vi.mock('framer-motion', () => ({
    motion: { div: ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => <div className={rest.className as string}>{children}</div> },
}));

function openAttachments() {
    const btn = screen.getByRole('button', { name: new RegExp(tMock('agentSectionAttachments')) });
    if (btn.getAttribute('aria-expanded') !== 'true') fireEvent.click(btn);
}

function Host({ initial, onChange }: { initial: Record<string, string>; onChange: (c: Record<string, string>) => void }) {
    const [siteConfigs, setSiteConfigs] = useState(initial);
    onChange(siteConfigs);
    return <AdminAgentTab siteConfigs={siteConfigs} setSiteConfigs={setSiteConfigs} onSubmit={e => e.preventDefault()} />;
}

// Oracle: the backend reads chat_attachments_max_file_bytes in bytes (default 50 MiB,
// range 1–500 MiB); the admin edits MB and the stored value is MB × 1024².
describe('AdminAgentTab — chat_attachments_max_file_bytes', () => {
    beforeEach(() => {
        try { localStorage.setItem('admin-agent-sections-open-v1', JSON.stringify({ attachments: true })); } catch { /* jsdom */ }
    });

    it('shows the 50 MB default and stores an edit in bytes', () => {
        let latest: Record<string, string> = {};
        render(<Host initial={{}} onChange={c => { latest = c; }} />);
        openAttachments();

        const input = screen.getByLabelText(tMock('chatAttachmentsMaxFileMb')) as HTMLInputElement;
        expect(input.type).toBe('number');
        expect(input.min).toBe('1');
        expect(input.max).toBe('500');
        expect(input.value).toBe('50');

        fireEvent.change(input, { target: { value: '100' } });
        expect(latest.chat_attachments_max_file_bytes).toBe(String(100 * 1024 * 1024));
    });

    it('shows a stored byte value in MB', () => {
        render(<Host initial={{ chat_attachments_max_file_bytes: String(10 * 1024 * 1024) }} onChange={() => {}} />);
        openAttachments();

        const input = screen.getByLabelText(tMock('chatAttachmentsMaxFileMb')) as HTMLInputElement;
        expect(input.value).toBe('10');
    });
});
