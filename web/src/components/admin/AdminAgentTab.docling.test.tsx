import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import AdminAgentTab from './AdminAgentTab';
import { translations } from '../../translations';

// Real English strings so labels can be matched by text.
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

// A tiny host that owns siteConfigs the way AdminPanel does, so the test
// observes real state updates rather than a mocked setter.
// Open the ingestion section whichever way the persisted open-map came up
// (jsdom localStorage is not reliable across environments).
function openIngestion() {
    const btn = screen.getByRole('button', { name: new RegExp(tMock('agentSectionIngestion')) });
    if (btn.getAttribute('aria-expanded') !== 'true') fireEvent.click(btn);
}

function Host({ initial, onChange }: { initial: Record<string, string>; onChange: (c: Record<string, string>) => void }) {
    const [siteConfigs, setSiteConfigs] = useState(initial);
    onChange(siteConfigs);
    return <AdminAgentTab siteConfigs={siteConfigs} setSiteConfigs={setSiteConfigs} onSubmit={e => e.preventDefault()} />;
}

describe('AdminAgentTab — Docling captioning and OCR fields', () => {
    beforeEach(() => {
        // Open the ingestion section so its inputs render.
        try { localStorage.setItem('admin-agent-sections-open-v1', JSON.stringify({ ingestion: true })); } catch { /* jsdom */ }
        // Radix Select measures and captures pointers; jsdom implements neither
        // (same shim as AdminEvalTab.test.tsx).
        Element.prototype.hasPointerCapture = vi.fn(() => false);
        Element.prototype.setPointerCapture = vi.fn();
        Element.prototype.releasePointerCapture = vi.fn();
        Element.prototype.scrollIntoView = vi.fn();
    });

    // The controls are the design system's (Radix Checkbox / Select, see
    // AdminAgentTab.test.tsx), so state is read off aria-checked / the trigger
    // text and driven through the ARIA roles rather than native .checked/.value.
    it('exposes the captioning, table-mode, prompt and OCR keys once Docling is on', async () => {
        let latest: Record<string, string> = {};
        render(<Host initial={{ docling_enabled: 'true', docling_base_url: 'http://docling:5001' }} onChange={c => { latest = c; }} />);
        openIngestion();

        const captioning = screen.getByRole('checkbox', { name: tMock('doclingPictureDescriptionEnabled') });
        expect(captioning).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(captioning);
        expect(latest.docling_picture_description_enabled).toBe('true');

        const prompt = screen.getByLabelText(tMock('doclingPictureDescriptionPrompt')) as HTMLTextAreaElement;
        fireEvent.change(prompt, { target: { value: 'Beschreibe die Abbildung.' } });
        expect(latest.docling_picture_description_prompt).toBe('Beschreibe die Abbildung.');

        const tableMode = screen.getByRole('combobox', { name: tMock('doclingTableMode') });
        expect(tableMode).toHaveTextContent(tMock('doclingTableModeAccurate'));
        await userEvent.click(tableMode);
        await userEvent.click(screen.getByRole('option', { name: tMock('doclingTableModeFast') }));
        expect(latest.docling_table_mode).toBe('fast');

        const langs = screen.getByLabelText(tMock('doclingOcrLanguages')) as HTMLInputElement;
        expect(langs.value).toBe('de,en');
        fireEvent.change(langs, { target: { value: 'de,en,fr' } });
        expect(latest.docling_ocr_languages).toBe('de,en,fr');

        fireEvent.click(screen.getByRole('checkbox', { name: tMock('doclingForceOcr') }));
        expect(latest.docling_force_ocr).toBe('true');

        const threshold = screen.getByLabelText(tMock('doclingPictureAreaThreshold')) as HTMLInputElement;
        expect(threshold.value).toBe('0.05');
    });

    it('disables the Docling fields while Docling itself is off', () => {
        render(<Host initial={{}} onChange={() => {}} />);
        openIngestion();
        expect(screen.getByRole('checkbox', { name: tMock('doclingPictureDescriptionEnabled') })).toBeDisabled();
        expect((screen.getByLabelText(tMock('doclingOcrLanguages')) as HTMLInputElement).disabled).toBe(true);
    });
});
