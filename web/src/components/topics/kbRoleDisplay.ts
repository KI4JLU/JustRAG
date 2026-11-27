import { Crown, Eye, Pencil, Shield, ShieldCheck } from 'lucide-react';
import type { ComponentType } from 'react';
import type { KbRole } from '../../types';

type IconType = ComponentType<{ className?: string; size?: number; 'aria-hidden'?: boolean | 'true' }>;

/** The icon of each KB role, as the Berechtigungen table shows it. */
export const KB_ROLE_ICON: Record<KbRole, IconType> = {
  view: Eye, edit: Pencil, admin: Shield, owner: Crown,
};

/** The translation key of each KB role's name (Leser, Bearbeiter, Admin, Besitzer). */
export const KB_ROLE_LABEL: Record<KbRole, string> = {
  view: 'kbRoleView', edit: 'kbRoleEdit', admin: 'kbRoleAdmin', owner: 'kbRoleOwner',
};

/** The icon for a superadmin holding no role on a topic (kbHeldRole null). */
export const SUPERADMIN_ICON: IconType = ShieldCheck;

/**
 * The name of a held role (kbHeldRole) — „Superadmin" for a superadmin
 * holding none — and, when the superadmin elevation lifts the caller above
 * it, the „Superadmin" qualifier („Leser · Superadmin").
 */
export function kbHeldRoleLabel(t: (key: string) => string, role: KbRole | null, elevated = false): string {
  const name = t(role ? KB_ROLE_LABEL[role] : 'kbRoleSuperadmin');
  return role && elevated ? `${name} · ${t('kbAccessQualifierSuperadmin')}` : name;
}
