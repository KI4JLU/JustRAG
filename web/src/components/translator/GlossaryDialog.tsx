import { useState } from 'react';
import { BookOpen, Eye, Globe, Lock, LogOut, Pencil, Plus, Share2, Trash2, Upload } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  PanelSection,
  SettingsRow,
  Spinner,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useModalContext } from '../../contexts/ModalContext';
import { userErrorMessage } from '../../utils/userErrors';
import { deleteGlossary, fetchGlossary, leaveGlossary } from './api';
import { IconAction } from './CopyButton';
import { GlossaryForm } from './GlossaryForm';
import { GlossaryImportForm } from './GlossaryImportForm';
import { GlossarySharing } from './GlossarySharing';
import { GLOSSARY_ROLE_LABEL_KEY } from './glossarySharingConfig';
import type { Glossary, GlossaryDetail, GlossaryList } from './types';

const ICON = { 'aria-hidden': true, className: 'size-4' } as const;

type View =
  | { name: 'list' }
  | { name: 'form'; glossary: GlossaryDetail | null; readOnly: boolean }
  | { name: 'import' }
  | { name: 'sharing'; glossaryId: string };

interface GlossaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `undefined` while the list loads (or when it could not be read, see `failed`). */
  list: GlossaryList | undefined;
  /** The list could not be read: it is shown with `onRetry` instead of loading for ever. */
  failed?: boolean;
  /** Reads the list again after a glossary was made, changed, deleted or left. */
  onChanged: () => void | Promise<void>;
  /** Tries the first read again; `onChanged` while left out. */
  onRetry?: () => void | Promise<void>;
}

/**
 * „Glossare verwalten": the glossaries the caller can open, with new, import, edit, share, delete
 * and leave. What a row offers follows the flags the list returns (`canEdit`, `canManage`,
 * `canDelete`), never the role: an editor changes entries, an admin the visibility and people,
 * the owner deletes; a viewer reads. A member other than the owner can leave (`isMember`); a user
 * who sees a global glossary without being added has nothing to leave. Nothing can be made until
 * the list (and with it the languages a term can be in) is read. The sharing view follows the
 * list: after a transfer or a change of visibility it shows the glossary as the list now has it,
 * and closes when the caller may no longer manage it.
 */
export function GlossaryDialog({ open, onOpenChange, list, failed = false, onChanged, onRetry }: GlossaryDialogProps) {
  const { t } = useTheme();
  const toast = useToast();
  const { showConfirm } = useModalContext();
  const [view, setView] = useState<View>({ name: 'list' });
  const [busy, setBusy] = useState<string | null>(null);
  const toList = (): void => setView({ name: 'list' });
  const reload = (): Promise<void> => Promise.resolve(onChanged());

  // The glossary of the sharing view as the list has it now.
  const shared = view.name === 'sharing' ? list?.glossaries.find((glossary) => glossary.id === view.glossaryId) : undefined;
  if (view.name === 'sharing' && !shared?.canManage) setView({ name: 'list' });

  const title =
    view.name === 'form'
      ? t(
          view.readOnly
            ? 'translatorGlossaryDetails'
            : view.glossary
              ? 'translatorGlossaryEdit'
              : 'translatorGlossaryNew',
        )
      : view.name === 'import'
        ? t('translatorGlossaryImport')
        : view.name === 'sharing'
          ? t('translatorGlossarySharingTitle').replace('{name}', shared?.name ?? '')
          : t('translatorGlossaryDialogTitle');

  const openGlossary = async (glossary: Glossary): Promise<void> => {
    setBusy(glossary.id);
    try {
      setView({ name: 'form', glossary: await fetchGlossary(glossary.id), readOnly: !glossary.canEdit });
    } catch {
      toast.error(t('translatorGlossaryLoadFailed'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (glossary: Glossary): Promise<void> => {
    const confirmed = await showConfirm(
      t('translatorGlossaryDeleteConfirm'),
      t('translatorGlossaryDeleteTitle').replace('{name}', glossary.name),
      { tone: 'destructive', confirmLabel: t('delete') },
    );
    if (!confirmed) return;
    try {
      await deleteGlossary(glossary.id);
      void reload();
    } catch (err: unknown) {
      toast.error(userErrorMessage(err, t, { fallbackKey: 'translatorGlossaryDeleteFailed' }));
    }
  };

  const leave = async (glossary: Glossary): Promise<void> => {
    const confirmed = await showConfirm(
      t('translatorGlossaryLeaveConfirm'),
      t('translatorGlossaryLeaveTitle').replace('{name}', glossary.name),
      { tone: 'destructive', confirmLabel: t('translatorGlossaryLeave') },
    );
    if (!confirmed) return;
    try {
      await leaveGlossary(glossary.id);
      void reload();
    } catch (err: unknown) {
      toast.error(userErrorMessage(err, t, { fallbackKey: 'translatorGlossaryLeaveFailed' }));
    }
  };

  const languages = list?.languages ?? [];
  // A term needs a language: nothing is made before the list that names them is read.
  const ready = languages.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) toList();
      }}
    >
      <DialogContent
        closeLabel={t('close')}
        // A long form scrolls in the dialog. Its grid has no column, so an unbreakable glossary
        // name would widen the content past the dialog; one shrinkable column keeps it inside and
        // lets the name truncate.
        className="max-h-9/10 grid-cols-1 overflow-y-auto sm:max-w-2xl"
        // Only the list explains itself, once, below its actions.
        {...(view.name === 'list' ? {} : { 'aria-describedby': undefined })}
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="wrap-anywhere">{title}</DialogTitle>
        </DialogHeader>
        {view.name === 'list' ? (
          <PanelSection title={t('translatorGlossariesChoose')} className="gap-stack-md">
            <div className="flex flex-wrap gap-stack-sm">
              <Button
                type="button"
                disabled={!ready}
                onClick={() => setView({ name: 'form', glossary: null, readOnly: false })}
              >
                <Plus {...ICON} />
                {t('translatorGlossaryNew')}
              </Button>
              <Button type="button" variant="outline" disabled={!ready} onClick={() => setView({ name: 'import' })}>
                <Upload {...ICON} />
                {t('translatorGlossaryImport')}
              </Button>
            </div>
            <DialogDescription>{t('translatorGlossariesExplain')}</DialogDescription>
            {!list ? (
              failed ? (
                <Alert tone="error">
                  <AlertDescription>{t('translatorGlossariesLoadFailed')}</AlertDescription>
                  <Button type="button" variant="outline" size="sm" onClick={() => void (onRetry ?? onChanged)()}>
                    {t('translatorGlossariesRetry')}
                  </Button>
                </Alert>
              ) : (
                <Spinner label={t('translatorGlossariesLoading')} />
              )
            ) : list.glossaries.length === 0 ? (
              <p className="m-0 text-on-surface-variant">{t('translatorGlossariesEmpty')}</p>
            ) : (
              <div role="list">
                {list.glossaries.map((glossary) => (
                  <GlossaryRow
                    key={glossary.id}
                    glossary={glossary}
                    loading={busy === glossary.id}
                    onOpen={() => void openGlossary(glossary)}
                    onShare={() => setView({ name: 'sharing', glossaryId: glossary.id })}
                    onDelete={() => void remove(glossary)}
                    onLeave={() => void leave(glossary)}
                  />
                ))}
              </div>
            )}
          </PanelSection>
        ) : view.name === 'form' ? (
          <GlossaryForm
            glossary={view.glossary}
            languages={languages}
            readOnly={view.readOnly}
            onDone={toList}
            onSaved={() => void reload()}
          />
        ) : view.name === 'import' ? (
          <GlossaryImportForm languages={languages} onDone={toList} onSaved={() => void reload()} />
        ) : shared ? (
          <GlossarySharing glossary={shared} onBack={toList} onChanged={reload} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** One glossary of the list: its name, category, owner and size, the caller's role and what they may do with it. */
function GlossaryRow({
  glossary,
  loading,
  onOpen,
  onShare,
  onDelete,
  onLeave,
}: {
  glossary: Glossary;
  loading: boolean;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
  onLeave: () => void;
}) {
  const { t } = useTheme();
  const terms = t(glossary.entryCount === 1 ? 'translatorGlossaryTermOne' : 'translatorGlossaryTerms').replace(
    '{count}',
    String(glossary.entryCount),
  );
  // The name takes two lines before it is cut: on a phone the badge and the icons leave little width.
  return (
    <SettingsRow
      role="listitem"
      data-testid={`glossary-row-${glossary.id}`}
      label={
        <span className="flex min-w-0 items-center gap-stack-sm">
          <BookOpen {...ICON} />
          <span className="line-clamp-2 break-words" title={glossary.name}>
            {glossary.name}
          </span>
          <Badge tone="neutral" className="shrink-0">
            {t(GLOSSARY_ROLE_LABEL_KEY[glossary.role])}
          </Badge>
        </span>
      }
      description={`${terms} • ${t('translatorGlossaryOwnerName').replace('{name}', glossary.creatorName)}`}
      control={
        <span className="flex items-center">
          <span
            className="flex size-9 items-center justify-center text-on-surface-variant"
            role="img"
            aria-label={t(`translatorGlossaryVisibility_${glossary.visibility}`)}
          >
            {glossary.visibility === 'global' ? <Globe {...ICON} /> : <Lock {...ICON} />}
          </span>
          <IconAction
            label={t(glossary.canEdit ? 'translatorGlossaryEditOne' : 'translatorGlossaryViewOne').replace(
              '{name}',
              glossary.name,
            )}
            disabled={loading}
            onClick={onOpen}
          >
            {glossary.canEdit ? <Pencil {...ICON} /> : <Eye {...ICON} />}
          </IconAction>
          {glossary.canManage ? (
            <IconAction label={t('translatorGlossaryShareOne').replace('{name}', glossary.name)} onClick={onShare}>
              <Share2 {...ICON} />
            </IconAction>
          ) : null}
          {glossary.canDelete ? (
            <IconAction label={t('translatorGlossaryDeleteOne').replace('{name}', glossary.name)} onClick={onDelete}>
              <Trash2 {...ICON} />
            </IconAction>
          ) : glossary.isMember ? (
            <IconAction label={t('translatorGlossaryLeaveOne').replace('{name}', glossary.name)} onClick={onLeave}>
              <LogOut {...ICON} />
            </IconAction>
          ) : null}
        </span>
      }
    />
  );
}
