import {
    DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
    SidebarUserMenu,
} from '@ki4jlu/design-system';
import {
    Accessibility, ExternalLink, FileText, LifeBuoy, LogOut, Settings, Shield, ShieldCheck, User,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../contexts/AppNavContext';
import { UserSettingsModal } from './UserSettingsModal';
import { openSettingsDialog, setSettingsDialogOpen, setSettingsDialogTab, useSettingsDialog } from '../hooks/settingsDialog';
import { roleLabel } from '../utils/roleLabel';

/**
 * The user menu of every sidebar (AppChrome's pages and the KB workspace):
 * account actions, „Einstellungen", which opens the settings window
 * (UserSettingsModal — colour scheme, language, profile), and „Hilfe" with
 * the legal pages. Before „Hilfe" those were linked only from the login
 * page's footer, so a signed-in user had no way to reach them.
 */
export function AppUserMenu() {
    const { t } = useTheme();
    const settingsDialog = useSettingsDialog();
    const { user, logout } = useAuth();
    const { onViewProfile, onViewAdmin, onViewLegal } = useAppNav();
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
                    setTimeout(() => openSettingsDialog(), 0);
                }}
            >
                <Settings size={16} aria-hidden="true" />
                {t('settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                    <LifeBuoy size={16} aria-hidden="true" />
                    {t('help')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                    {/* The operator's imprint is an external page (imprintUrl),
                        the other three are the app's own legal views. */}
                    <DropdownMenuItem asChild>
                        <a href={t('imprintUrl')} target="_blank" rel="noopener noreferrer">
                            <FileText size={16} aria-hidden="true" />
                            {t('imprint')}
                            <ExternalLink className="ml-auto !size-3.5 text-on-surface-variant" aria-hidden="true" />
                        </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onViewLegal('terms')}>
                        <FileText size={16} aria-hidden="true" />
                        {t('termsOfUse')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onViewLegal('privacy')}>
                        <ShieldCheck size={16} aria-hidden="true" />
                        {t('privacyPolicy')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onViewLegal('accessibility')}>
                        <Accessibility size={16} aria-hidden="true" />
                        {t('accessibility')}
                    </DropdownMenuItem>
                </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem variant="destructive" onSelect={logout}>
                <LogOut size={16} aria-hidden="true" />
                {t('logout')}
            </DropdownMenuItem>
        </SidebarUserMenu>
        <UserSettingsModal open={settingsDialog.open} onOpenChange={setSettingsDialogOpen} tab={settingsDialog.tab} onTabChange={setSettingsDialogTab} />
        </>
    );
}
