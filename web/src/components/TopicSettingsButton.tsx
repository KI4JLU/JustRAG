import { useId } from 'react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@ki4jlu/design-system';
import { Settings } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { TopicSettingsDiff } from '../utils/topicSettingsDiff';

export interface TopicSettingsButtonProps {
  diff: TopicSettingsDiff;
  onClick: () => void;
}

/**
 * The gear that opens „Thema-Einstellungen". Hover, focus and press are
 * interaction states only. That the topic's settings differ from the template
 * is its own, permanent marker: a dot on the button, and a tooltip (hover and
 * keyboard focus) that names the areas that differ — own role, own rules, own
 * start page. A screen reader gets „angepasst" in the button's name and the
 * areas in its description.
 */
export function TopicSettingsButton({ diff, onClick }: TopicSettingsButtonProps) {
  const { t } = useTheme();
  const descriptionId = useId();
  const title = t('topicSettingsButton');
  const areas = diff.labels.join(', ');

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <Button
          id="kb-header-system-prompt-toggle"
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          onClick={onClick}
          aria-haspopup="dialog"
          aria-label={diff.isCustomized ? `${title} – ${t('topicSettingsCustomized')}` : title}
          aria-describedby={diff.isCustomized ? descriptionId : undefined}
        >
          <Settings size={20} aria-hidden="true" />
          {diff.isCustomized && (
            <span
              aria-hidden="true"
              data-slot="topic-settings-dot"
              className="absolute top-1 right-1 size-[9px] rounded-full bg-primary ring-2 ring-canvas"
            />
          )}
          {diff.isCustomized && <span id={descriptionId} hidden>{areas}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <span className="block font-semibold">{title}</span>
        {diff.isCustomized && (
          <span className="mt-1 flex items-start gap-1.5 font-normal">
            <span aria-hidden="true" className="mt-[0.4em] size-1.5 shrink-0 rounded-full bg-current" />
            {areas}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
