import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { translations } from '../../i18n/translations';
import type { KnowledgeBase } from '../../types';
import { getKbPreview, setKbPreview } from '../../preview/kbPreview';
import { KbAccessChip } from './KbAccessChip';

/* The topic bar's role chip for a superadmin. Oracle: the server resolves a
 * superadmin to owner on every topic (kbaccess.ResolveRole, origin
 * 'superadmin'); the chip must name the role they hold and show the elevation
 * as the „Superadmin" qualifier, while rights and the preview stay elevated.
 * Strings from translations.ts. */

const DE = Object.fromEntries(Object.entries(translations).map(([k, v]) => [k, (v as { de: string }).de]));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => DE[k] ?? k }) }));

function kb(over: Partial<KnowledgeBase>): KnowledgeBase {
  return {
    id: 'kb-1', name: 'Plone', description: null, userId: 'other', createdAt: '2026-01-05T09:00:00Z',
    isPro: false, aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
    visibility: 'private', memberCount: 3, effectiveRole: 'owner', roleOrigin: 'superadmin',
    capabilities: { seeSources: true, addSources: true, previewSources: true, downloadSources: true, seeCitations: true, manageSources: true },
    ...over,
  };
}

describe('KbAccessChip for a superadmin', () => {
  afterEach(() => setKbPreview(null));

  it('names the held viewer role with the Superadmin qualifier and keeps the elevated rights', async () => {
    render(<KbAccessChip kb={kb({ myRole: 'view', roleGrantedBy: { firstName: 'Test', lastName: 'User', username: 'test' } })} />);
    const chip = screen.getByRole('button', { name: new RegExp(`${DE.kbRoleView} · ${DE.kbAccessQualifierSuperadmin}`) });
    expect(chip).not.toHaveTextContent(DE.kbRoleOwner);
    await userEvent.click(chip);
    expect(screen.getByText(DE.rrTipAlwaysAll)).toBeInTheDocument();
    expect(screen.getByText(DE.kbPreviewAs)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(DE.kbAccessOriginSuperadmin))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(DE.kbAccessAskForMore))).toBeNull();
    // The preview remembers the held role and the elevation, for the banner.
    await userEvent.click(screen.getByRole('button', { name: DE.kbRoleEdit }));
    expect(getKbPreview()).toEqual({ kbId: 'kb-1', role: 'edit', ownRole: 'view', superadmin: true });
  });

  it('names a superadmin holding no role „Superadmin", once', async () => {
    render(<KbAccessChip kb={kb({ visibility: 'public', isGlobal: true, isPublished: false })} />);
    const chip = screen.getByRole('button', { name: new RegExp(DE.kbRoleSuperadmin) });
    expect(chip).not.toHaveTextContent(DE.kbRoleOwner);
    expect(chip).not.toHaveTextContent('·');
    await userEvent.click(chip);
    expect(screen.getAllByText(new RegExp(DE.kbAccessOriginSuperadmin))).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: DE.kbRoleView }));
    expect(getKbPreview()).toEqual({ kbId: 'kb-1', role: 'view', ownRole: null, superadmin: true });
  });

  it('shows an owned topic as Besitzer without a qualifier', () => {
    render(<KbAccessChip kb={kb({ myRole: 'owner', userId: 'me' })} />);
    const chip = screen.getByRole('button', { name: new RegExp(DE.kbRoleOwner) });
    expect(chip).not.toHaveTextContent(DE.kbAccessQualifierSuperadmin);
  });
});
