import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from '@ki4jlu/design-system';
import { SquareDashedMousePointer } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { setKbPreview, type KbPreview } from '../../preview/kbPreview';
import { KB_ROLE_LABEL } from './kbRoleDisplay';

/**
 * The banner above the app while a KB admin previews the open topic as a
 * lower role (mockup KI-1089): which role, whose view it is, a switch to the
 * other previewable role and the way out. It sits in the shell's notice slot,
 * so it stays visible on every area of the topic.
 */
export function KbPreviewBanner({ preview }: { preview: KbPreview }) {
  const { t } = useTheme();
  const role = t(KB_ROLE_LABEL[preview.role]);
  const roles = t(preview.role === 'edit' ? 'rrRolePluralEdit' : 'rrRolePluralView');
  const other = preview.role === 'edit' ? 'view' : 'edit';
  const link = 'h-auto p-0 font-semibold text-current underline';
  return (
    <Alert tone="info" layout="banner" live="polite" icon={<SquareDashedMousePointer aria-hidden="true" />}>
      <AlertTitle>{t('kbPreviewBannerTitle').replace('{role}', role)}</AlertTitle>
      <AlertDescription>
        {t('kbPreviewBannerText').replace('{roles}', roles).replace('{role}', t(KB_ROLE_LABEL[preview.ownRole]))}
      </AlertDescription>
      <AlertAction>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Button type="button" variant="link" size="sm" className={link} onClick={() => setKbPreview({ ...preview, role: other })}>
            {t('kbPreviewSwitch').replace('{role}', t(KB_ROLE_LABEL[other]))}
          </Button>
          <Button type="button" variant="link" size="sm" className={link} onClick={() => setKbPreview(null)}>
            {t('kbPreviewEnd')}
          </Button>
        </span>
      </AlertAction>
    </Alert>
  );
}
