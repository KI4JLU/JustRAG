/** The system role as a translated label; falls back to the raw value for an unknown role. */
export function roleLabel(role: string | undefined, t: (k: string) => string): string {
    switch (role) {
        case 'user': return t('roleUser');
        case 'api-user': return t('roleApiUser');
        case 'admin': return t('roleAdmin');
        case 'superadmin': return t('roleSuperAdmin');
        default: return role ?? '';
    }
}
