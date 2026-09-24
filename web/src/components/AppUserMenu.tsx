import { useState } from 'react';
import { DropdownMenuItem, DropdownMenuSeparator, SidebarUserMenu } from '@ki4jlu/design-system';
import {
    LogOut, Settings, Shield, User,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../contexts/AppNavContext';
import { UserSettingsModal, type SettingsTab } from './UserSettingsModal';
import { roleLabel } from '../utils/roleLabel';

/**
 * The user menu of every sidebar (AppChrome's pages and the KB workspace):
 * account actions and „Einstellungen", which opens the settings window
 * (UserSettingsModal — colour scheme, Style, language, profile).
 */
export function AppUserMenu() {
    const { t } = useTheme();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
    const { user, logout } = useAuth();
    const { onViewProfile, onViewAdmin } = useAppNav();
    const isSystemAdmin = user?.role === 'admin' || user?.role === 'superadmin';


    return (
        <>
        <SidebarUserMenu
            initials={(user?.username ?? '').slice(0, 2).toUpperCase()}
            name={`@${user?.username}`}
            role={roleLabel(user?.role, t)}
        >
            <DropdownMenuItem onSelect={onViewProfile}>
                <User size={16} aria-hidden="true" />
                {t('profile')}
            </DropdownMenuItem>
            {/* The ONLY route into the admin UI (KI-782). */}
            {isSystemAdmin && (
                <DropdownMenuItem onSelect={onViewAdmin}>
                    <Shield size={16} aria-hidden="true" />
                    {t('adminSettings')}
                </DropdownMenuItem>
            )}
            <DropdownMenuItem
                onSelect={() => {
                    // After the menu's own close: Radix hands focus back to the
                    // trigger first, then the dialog takes it.
                    setTimeout(() => setSettingsOpen(true), 0);
                }}
            >
                <Settings size={16} aria-hidden="true" />
                {t('settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={logout}>
                <LogOut size={16} aria-hidden="true" />
                {t('logout')}
            </DropdownMenuItem>
        </SidebarUserMenu>
        <UserSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} tab={settingsTab} onTabChange={setSettingsTab} />
        </>
    );
}
