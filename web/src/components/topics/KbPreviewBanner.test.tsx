import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import { KbPreviewBanner } from './KbPreviewBanner';

/* The preview banner names the role the caller returns to. Oracle:
 * translations.ts („Du bleibst {role}"), and the chip's wording for a
 * superadmin — the held role with the „Superadmin" qualifier, or „Superadmin"
 * alone where they hold none. */

const DE = Object.fromEntries(Object.entries(translations).map(([k, v]) => [k, (v as { de: string }).de]));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => DE[k] ?? k }) }));

const remain = (text: string) => new RegExp(`${text}\\.`);

describe('KbPreviewBanner', () => {
  it('names a plain held role', () => {
    render(<KbPreviewBanner preview={{ kbId: 'kb-1', role: 'view', ownRole: 'owner' }} />);
    expect(screen.getByText(remain(`bleibst ${DE.kbRoleOwner}`))).toBeInTheDocument();
  });

  it('keeps the Superadmin qualifier of an elevated superadmin', () => {
    render(<KbPreviewBanner preview={{ kbId: 'kb-1', role: 'edit', ownRole: 'view', superadmin: true }} />);
    expect(screen.getByText(remain(`bleibst ${DE.kbRoleView} · ${DE.kbAccessQualifierSuperadmin}`))).toBeInTheDocument();
  });

  it('names a superadmin holding no role „Superadmin"', () => {
    render(<KbPreviewBanner preview={{ kbId: 'kb-1', role: 'view', ownRole: null, superadmin: true }} />);
    expect(screen.getByText(remain(`bleibst ${DE.kbRoleSuperadmin}`))).toBeInTheDocument();
  });
});
