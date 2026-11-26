import { Crown, Eye, Pencil, Shield } from 'lucide-react';
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
