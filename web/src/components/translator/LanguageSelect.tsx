import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { languageOptions } from './languages';
import { isTranslatorLanguage, type TranslatorLanguage } from './types';

/** Radix Select needs a non-empty value; this one stands for "detect the language". */
const DETECT = 'detect';

type LanguageSelectProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  id: string;
  disabled?: boolean;
  className?: string;
} & (
  | {
      /** Offers "detect language" first, as `null`. */
      allowDetect: true;
      value: TranslatorLanguage | null;
      onChange: (language: TranslatorLanguage | null) => void;
      /** Named in the detect entry once a translation found it. */
      detected?: TranslatorLanguage | null;
    }
  | {
      allowDetect?: false;
      value: TranslatorLanguage;
      onChange: (language: TranslatorLanguage) => void;
      detected?: undefined;
    }
);

/** The translator's languages, named in the UI language. */
export function LanguageSelect(props: LanguageSelectProps) {
  const { id, disabled, className, value, detected } = props;
  const { t } = useTheme();
  const options = languageOptions(t);
  const detectedName = detected ? options.find((option) => option.code === detected)?.name : null;

  const handleChange = (next: string): void => {
    if (props.allowDetect && next === DETECT) {
      props.onChange(null);
      return;
    }
    if (isTranslatorLanguage(next)) props.onChange(next);
  };

  return (
    <Select value={value ?? DETECT} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        className={className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.allowDetect ? (
          <>
            <SelectItem value={DETECT}>
              {detectedName
                ? t('translatorDetected').replace('{language}', detectedName)
                : t('translatorDetectLanguage')}
            </SelectItem>
            <SelectSeparator />
          </>
        ) : null}
        {options.map((option) => (
          <SelectItem key={option.code} value={option.code}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
