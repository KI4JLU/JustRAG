import { useMemo, useState } from 'react';
import { Globe, Lock } from 'lucide-react';
import {
  Button,
  Label,
  PanelSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { userErrorMessage } from '../../utils/userErrors';
import { SharingPanel } from '../people/SharingPanel';
import { setGlossaryVisibility } from './api';
import { glossarySharingConfig } from './glossarySharingConfig';
import { GLOSSARY_VISIBILITIES, type Glossary, type GlossaryVisibility } from './types';

interface GlossarySharingProps {
  /** The glossary as the list has it now: its role and visibility follow a reload. */
  glossary: Glossary;
  onBack: () => void;
  /** The visibility or the owner changed; the list is read again. */
  onChanged: () => void | Promise<void>;
}

/**
 * Who may use a glossary: its visibility (private, or global for everyone as a viewer) and its
 * people. Reached from the list by those who may manage it (`canManage`): an admin or the owner.
 */
export function GlossarySharing({ glossary, onBack, onChanged }: GlossarySharingProps) {
  const { t } = useTheme();
  const toast = useToast();
  const [view, setView] = useState<'members' | 'add'>('members');
  const [visibility, setVisibility] = useState<GlossaryVisibility>(glossary.visibility);
  // What the list says wins as soon as it moves on (a reload after the change below).
  const [listed, setListed] = useState<GlossaryVisibility>(glossary.visibility);
  if (listed !== glossary.visibility) {
    setListed(glossary.visibility);
    setVisibility(glossary.visibility);
  }
  const config = useMemo(() => glossarySharingConfig(glossary.id), [glossary.id]);

  const changeVisibility = async (next: GlossaryVisibility): Promise<void> => {
    const previous = visibility;
    setVisibility(next);
    try {
      await setGlossaryVisibility(glossary.id, next);
      void onChanged();
    } catch (err: unknown) {
      setVisibility(previous);
      toast.error(userErrorMessage(err, t, { fallbackKey: 'translatorGlossaryUpdateFailed' }));
    }
  };

  return (
    <div className="grid gap-stack-md">
      {view === 'members' ? (
        <>
          <PanelSection
            title={t('translatorGlossaryVisibilityLabel')}
            hint={t(`translatorGlossaryVisibilityHint_${visibility}`)}
          >
            <div className="flex items-center gap-3">
              <Label htmlFor={`glossary-visibility-${glossary.id}`} className="sr-only">
                {t('translatorGlossaryVisibilityLabel')}
              </Label>
              <Select value={visibility} onValueChange={(next) => void changeVisibility(next as GlossaryVisibility)}>
                <SelectTrigger id={`glossary-visibility-${glossary.id}`} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GLOSSARY_VISIBILITIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`translatorGlossaryVisibility_${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {visibility === 'global' ? (
                <Globe aria-hidden="true" className="size-4" />
              ) : (
                <Lock aria-hidden="true" className="size-4" />
              )}
            </div>
          </PanelSection>
          <h3 className="m-0 text-base font-semibold text-on-surface">{t('members')}</h3>
        </>
      ) : null}
      <SharingPanel
        config={config}
        myRole={glossary.role}
        view={view}
        onViewChange={setView}
        onOwnerChanged={() => void onChanged()}
      />
      {view === 'members' ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onBack}>
            {t('translatorBack')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
