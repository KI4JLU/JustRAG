import { LogOut, Settings, Shield, User } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../contexts/AppNavContext';
import { openSettingsDialog } from './settingsDialog';
import type { SearchDefaultGroup } from '../components/GlobalSearch';

/**
 * The account group of the search field's default list — the user menu's
 * entries (`AppUserMenu`), in its order, so ⌘K reaches them too. Shared by the
 * shell header and the topic workspace search, and always their LAST group:
 * „Abmelden" ends the list.
 */
export function useAccountSearchGroup(): SearchDefaultGroup {
  const { t } = useTheme();
  const { user, logout } = useAuth();
  const { onViewProfile, onViewAdmin } = useAppNav();
  const isSystemAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  return {
    heading: t('searchDefaultsAccount'),
    items: [
      { id: 'settings', label: t('settings'), icon: <Settings aria-hidden="true" />, onSelect: () => openSettingsDialog() },
      { id: 'profile', label: t('profile'), icon: <User aria-hidden="true" />, onSelect: onViewProfile },
      ...(isSystemAdmin
        ? [{ id: 'admin', label: t('adminSettings'), icon: <Shield aria-hidden="true" />, onSelect: onViewAdmin }]
        : []),
      { id: 'logout', label: t('logout'), icon: <LogOut aria-hidden="true" />, onSelect: logout },
    ],
  };
}
