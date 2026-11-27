import { Check, ChevronDown } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { languageOptions, type SourceLanguage } from './languages';
import type { TranslatorLanguage } from './types';

type LanguageMenuProps = {
  /** Names the menu for screenreaders, e.g. "Ausgangssprache". */
  label: string;
  disabled?: boolean;
  className?: string;
} & (
  | {
      /** Offers "Automatisch" first. */
      allowAuto: true;
      value: SourceLanguage;
      onChange: (language: SourceLanguage) => void;
    }
  | {
      allowAuto?: false;
      value: TranslatorLanguage;
      onChange: (language: TranslatorLanguage) => void;
    }
);

/**
 * A language of the translator's bar: its name with a chevron, opening the fixed list of
 * languages (no search). The chosen one is marked. The list is a menu of radio items, so the
 * arrow keys, type-ahead, Enter and Escape work as in any menu.
 */
export function LanguageMenu(props: LanguageMenuProps) {
  const { t } = useTheme();
  const options = languageOptions(t);
  const name =
    props.value === 'auto'
      ? t('translatorDetectLanguage')
      : (options.find((option) => option.code === props.value)?.name ?? props.value);
  const items: Array<{ code: SourceLanguage; name: string }> = props.allowAuto
    ? [{ code: 'auto', name: t('translatorDetectLanguage') }, ...options]
    : options;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={props.disabled}>
        <Button type="button" variant="ghost" aria-label={`${props.label}: ${name}`} className={props.className}>
          {/* A picker's label cannot become an icon: a long language name is cut off in a narrow
              card rather than pushing the bar out of it. */}
          <span className="truncate">{name}</span>
          <ChevronDown aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={props.label} className="max-h-96 overflow-y-auto">
        {items.map((item) => {
          const selected = item.code === props.value;
          return (
            <DropdownMenuItem
              key={item.code}
              role="menuitemradio"
              aria-checked={selected}
              selected={selected}
              onSelect={() => {
                if (props.allowAuto) props.onChange(item.code);
                else if (item.code !== 'auto') props.onChange(item.code);
              }}
            >
              <span className="flex-1">{item.name}</span>
              {selected ? <Check aria-hidden="true" className="size-4" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
