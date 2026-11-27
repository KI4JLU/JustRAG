import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from '@ki4jlu/design-system';
import { Check, ChevronDown, Eye, Minus, Pencil, SquareDashedMousePointer } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { setKbPreview } from '../../preview/kbPreview';
import type { KbCapabilities, KbPreviewRole, KbRole, KnowledgeBase } from '../../types';
import { kbDisplayRole, kbEffectiveRole } from '../../utils/kbAccess';
import { KB_ROLE_ICON, KB_ROLE_LABEL } from './kbRoleDisplay';

const QUALIFIER: Partial<Record<NonNullable<KnowledgeBase['roleOrigin']>, string>> = {
  public: 'kbAccessQualifierPublic', systemAdmin: 'kbAccessQualifierSystemAdmin', superadmin: 'kbAccessQualifierSuperadmin',
};

/**
 * The rights the popover lists, in the mockup's order. A capability comes
 * from the server (kbaccess.CapabilitiesFor); `ask` is every role's, and
 * inviting and configuring are admin and owner only — whom the popover does
 * not list rights for (they "always have every right").
 */
const RIGHTS: { right: keyof KbCapabilities | 'ask' | 'invite' | 'settings'; label: string }[] = [
  { right: 'ask', label: 'kbAccessRightAsk' },
  { right: 'seeCitations', label: 'kbAccessRightSeeCitations' },
  { right: 'seeSources', label: 'kbAccessRightSeeSources' },
  { right: 'previewSources', label: 'kbAccessRightPreviewSources' },
  { right: 'downloadSources', label: 'kbAccessRightDownloadSources' },
  { right: 'addSources', label: 'kbAccessRightAddSources' },
  { right: 'manageSources', label: 'kbAccessRightManageSources' },
  { right: 'invite', label: 'kbAccessRightInvite' },
  { right: 'settings', label: 'kbAccessRightSettings' },
];

function granted(right: (typeof RIGHTS)[number]['right'], caps: KbCapabilities): boolean {
  if (right === 'ask') return true;
  if (right === 'invite' || right === 'settings') return false;
  return caps[right];
}

function personName(p: NonNullable<KnowledgeBase['roleGrantedBy']>): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username;
}

export interface KbAccessChipProps {
  kb: KnowledgeBase;
}

/**
 * The caller's Berechtigung on the open topic, in the topic bar (mockup
 * KI-1089): a chip with the role, and a popover with what the role may do
 * here (from the server's capabilities, never re-derived) and where it comes
 * from. For KB admins and owners it is also the way into the preview („Thema
 * ansehen als"); in a preview it names the previewed role and ends the
 * preview.
 *
 * The chip names the role the caller holds on the topic (kbDisplayRole); a
 * superadmin's elevation shows as the „Superadmin" qualifier next to it, while
 * the rights and the preview follow the elevated role (kbEffectiveRole).
 */
export function KbAccessChip({ kb }: KbAccessChipProps) {
  const { t } = useTheme();
  const role = kbDisplayRole(kb);
  const acting = kbEffectiveRole(kb);
  const preview = kb.previewRole ?? null;
  const RoleIcon = KB_ROLE_ICON[role];
  const label = t(KB_ROLE_LABEL[role]);
  // The superadmin elevation raised the caller above the role they hold.
  const elevated = !preview && kb.roleOrigin === 'superadmin' && role !== acting;
  // Where the role they hold comes from: their kb_members row, else a
  // published public topic; only a superadmin with neither acts on the
  // system role alone.
  const origin: KnowledgeBase['roleOrigin'] = kb.roleOrigin === 'superadmin'
    ? (kb.myRole ? 'member' : elevated ? 'public' : 'superadmin')
    : kb.roleOrigin;
  const qualifierKey = preview ? undefined : elevated ? QUALIFIER.superadmin : origin ? QUALIFIER[origin] : undefined;
  const qualifier = qualifierKey ? t(qualifierKey) : null;
  const fullRights = acting === 'admin' || acting === 'owner';
  const canPreview = !preview && fullRights;

  const startPreview = (next: KbPreviewRole) => setKbPreview({ kbId: kb.id, role: next, ownRole: role });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // eslint-disable-next-line design-system/layout-only-classname -- the chip as in the KI-1089 mockup: px-3, and in a preview the primary border and text
          className={preview ? 'gap-1.5 border-primary px-3 text-primary' : 'gap-1.5 px-3'}
          aria-label={preview
            ? `${t('kbPreviewBannerTitle').replace('{role}', label)}. ${t('kbAccessShowDetails')}`
            : t('kbAccessChipLabel').replace('{role}', qualifier ? `${label} · ${qualifier}` : label)}
        >
          {preview ? <SquareDashedMousePointer className="size-4" aria-hidden="true" /> : <RoleIcon className="size-4" aria-hidden="true" />}
          <span>
            {preview ? t('kbPreviewChip').replace('{role}', label) : label}
            {qualifier && <span className="font-normal text-on-surface-variant"> · {qualifier}</span>}
          </span>
          <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-start gap-3">
            <span
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-fixed text-on-primary-fixed"
              aria-hidden="true"
            >
              <RoleIcon className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="m-0 text-xs text-on-surface-variant">
                {preview ? t('kbAccessPreviewHeading') : t('kbAccessHeading')}
              </p>
              <p className="m-0 text-base font-semibold text-on-surface">
                {label}
                {qualifier && <Badge tone="neutral" className="ml-2 align-middle">{qualifier}</Badge>}
              </p>
            </div>
          </div>
          {fullRights ? (
            <p className="m-0 flex items-start gap-2 text-sm text-on-surface">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              {t('rrTipAlwaysAll')}
            </p>
          ) : kb.capabilities && <RightsList caps={kb.capabilities} />}
          <p className="m-0 text-xs text-on-surface-variant">
            {preview ? t('kbAccessOriginPreview') : <Origin kb={kb} origin={origin} role={role} elevated={elevated} />}
          </p>
        </div>
        {canPreview && (
          <div className="flex flex-col gap-2 border-t border-outline-variant p-4">
            <p className="m-0 text-sm font-semibold text-on-surface">{t('kbPreviewAs')}</p>
            <p className="m-0 text-xs text-on-surface-variant">{t('kbPreviewHint')}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => startPreview('edit')}>
                <Pencil className="size-4" aria-hidden="true" />
                {t('kbRoleEdit')}
              </Button>
              <Button type="button" variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => startPreview('view')}>
                <Eye className="size-4" aria-hidden="true" />
                {t('kbRoleView')}
              </Button>
            </div>
          </div>
        )}
        {preview && (
          <div className="border-t border-outline-variant p-4">
            <Button type="button" size="sm" className="w-full" onClick={() => setKbPreview(null)}>
              {t('kbPreviewEnd')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Where the caller's role comes from: who granted it, or the implicit rule —
 * followed, for a superadmin acting above that role, by the elevation.
 */
function Origin({ kb, origin, role, elevated }: { kb: KnowledgeBase; origin: KnowledgeBase['roleOrigin']; role: KbRole; elevated: boolean }) {
  const { t } = useTheme();
  if (!elevated) return <OwnOrigin kb={kb} origin={origin} role={role} />;
  return <><OwnOrigin kb={kb} origin={origin} role={role} elevated /> {t('kbAccessOriginSuperadmin')}</>;
}

function OwnOrigin({ kb, origin, role, elevated = false }: { kb: KnowledgeBase; origin: KnowledgeBase['roleOrigin']; role: KbRole; elevated?: boolean }) {
  const { t } = useTheme();
  if (origin === 'public') return <>{t('kbAccessOriginPublic')}</>;
  if (origin === 'systemAdmin') return <>{t('kbAccessOriginSystemAdmin')}</>;
  if (origin === 'superadmin') return <>{t('kbAccessOriginSuperadmin')}</>;
  const by = kb.roleGrantedBy;
  if (by) {
    const [before, after] = t('kbAccessGrantedBy').split('{name}');
    return (
      <>
        {before}<strong className="font-semibold text-on-surface">{personName(by)}</strong>{after}
        {by.role && <> {t('kbAccessGrantedByRole').replace('{role}', t(KB_ROLE_LABEL[by.role]))}</>}
        .{role === 'view' && !elevated && <> {t('kbAccessAskForMore')}</>}
      </>
    );
  }
  return role === 'owner' ? <>{t('kbAccessOriginCreated')}</> : null;
}

function RightsList({ caps }: { caps: KbCapabilities }) {
  const { t } = useTheme();
  const yes = RIGHTS.filter((r) => granted(r.right, caps));
  const no = RIGHTS.filter((r) => !granted(r.right, caps));
  return (
    <div className="flex flex-col gap-3">
      <RightsGroup title={t('kbAccessYouCan')} items={yes.map((r) => t(r.label))} granted />
      {no.length > 0 && <RightsGroup title={t('kbAccessNotGranted')} items={no.map((r) => t(r.label))} granted={false} />}
    </div>
  );
}

function RightsGroup({ title, items, granted: isGranted }: { title: string; items: string[]; granted: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-xs font-semibold tracking-wide text-on-surface-variant uppercase">{title}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item) => (
          <li key={item} className={`flex items-start gap-2 text-sm ${isGranted ? 'text-on-surface' : 'text-on-surface-variant'}`}>
            {isGranted
              ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              : <Minus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
