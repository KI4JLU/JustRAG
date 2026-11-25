/*
 * The translator's contract with the server (docs/api-contracts/translator.md, API.md
 * "Translator and glossaries"): its languages, the settings of a request and the glossaries.
 */

/** The translator's languages in menu order. A model's report is normalised to one of these. */
export const TRANSLATOR_LANGUAGES = [
  'en-gb',
  'en-us',
  'de',
  'uk',
  'fr',
  'es',
  'it',
  'nl',
  'pl',
  'pt',
  'ru',
  'zh',
  'ja',
] as const;
export type TranslatorLanguage = (typeof TRANSLATOR_LANGUAGES)[number];

export function isTranslatorLanguage(value: unknown): value is TranslatorLanguage {
  return typeof value === 'string' && (TRANSLATOR_LANGUAGES as readonly string[]).includes(value);
}

/** The language of a glossary term; both English variants use the `en` terms. */
export const GLOSSARY_LANGUAGES = ['de', 'en', 'uk', 'fr', 'es', 'it'] as const;
export type GlossaryLanguage = (typeof GLOSSARY_LANGUAGES)[number];

export type Formality = 'default' | 'formal' | 'informal';
export const REPHRASE_STYLES = ['business', 'academic', 'casual', 'simple'] as const;
export type RephraseStyle = (typeof REPHRASE_STYLES)[number];
export const REPHRASE_TONES = ['confident', 'diplomatic', 'enthusiastic', 'friendly'] as const;
export type RephraseTone = (typeof REPHRASE_TONES)[number];

/** Limits of a request, as GET /api/translator/config reports them. */
export interface TranslatorLimits {
  textMax: number;
  segmentsMax: number;
  detectSampleMax: number;
  suggestTextMax: number;
  glossariesPerRequestMax: number;
  glossaryImportMaxBytes: number;
}

/** What the server falls back on before (or without) a config answer: the contract's numbers. */
export const DEFAULT_LIMITS: TranslatorLimits = {
  textMax: 50_000,
  segmentsMax: 5_000,
  detectSampleMax: 500,
  suggestTextMax: 2_000,
  glossariesPerRequestMax: 20,
  glossaryImportMaxBytes: 5 << 20,
};

/** GET /api/translator/config. */
export interface TranslatorConfig {
  enabled: boolean;
  defaultTargetLanguage: string;
  languages: { code: string; name: string }[];
  glossaryLanguages: string[];
  /** The model the calls run on; empty when none can be resolved. */
  model: string;
  /** Where it comes from: the Fast Tier setting, or (that being empty) the provider's default chat model. */
  modelSource: 'fastTier' | 'default' | '';
  limits: TranslatorLimits;
}

/** The text modes of the page. */
export type TextMode = 'translate' | 'rephrase';

// --- Requests ---------------------------------------------------------------------------------

/** What every text request carries besides the text. */
export interface TextRequestSettings {
  formality: Formality;
  style: RephraseStyle | null;
  tone: RephraseTone | null;
  glossaryIds: readonly string[];
}

export interface TranslateRequest extends Partial<TextRequestSettings> {
  text: string[];
  source: TranslatorLanguage | null;
  target: TranslatorLanguage;
}

export interface TranslateResponse {
  text: string[];
  detectedSource: TranslatorLanguage | null;
}

export interface RephraseRequest extends Partial<TextRequestSettings> {
  text: string[];
  language: TranslatorLanguage | null;
}

export interface RephraseResponse {
  text: string[];
  detectedLanguage: TranslatorLanguage | null;
}

export interface DetectRequest {
  text: string;
}

export type SuggestKind = 'alternatives' | 'synonyms' | 'correction';

export interface SuggestRequest extends Partial<Omit<TextRequestSettings, 'glossaryIds'>> {
  kind: SuggestKind;
  text: string;
  context?: string;
  language?: TranslatorLanguage | null;
  exclusions?: string[];
}

// --- Glossaries -------------------------------------------------------------------------------

export type GlossaryRole = 'viewer' | 'editor' | 'admin' | 'owner';
/** The roles a person can be given; the owner moves only through the transfer. */
export type GlossaryAssignableRole = Exclude<GlossaryRole, 'owner'>;
export const GLOSSARY_VISIBILITIES = ['private', 'global'] as const;
export type GlossaryVisibility = (typeof GLOSSARY_VISIBILITIES)[number];

export interface GlossaryEntry {
  sourceLanguage: GlossaryLanguage;
  sourceTerm: string;
  targetLanguage: GlossaryLanguage;
  targetTerm: string;
}

/** A glossary as GET /api/glossaries lists it; `role` and the three flags are the caller's. */
export interface Glossary {
  id: string;
  name: string;
  description: string;
  category: string;
  visibility: GlossaryVisibility;
  entryCount: number;
  /** The owner's name. */
  creatorName: string;
  role: GlossaryRole;
  /**
   * Whether a membership row stands behind the role. On a global glossary every user is a viewer
   * without one, and only a member can leave.
   */
  isMember: boolean;
  canEdit: boolean;
  canManage: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryDetail extends Glossary {
  entries: GlossaryEntry[];
}

export interface GlossaryList {
  glossaries: Glossary[];
  languages: GlossaryLanguage[];
}

/** The body of a new glossary or of all of an edited one (PUT). */
export interface GlossaryInput {
  name: string;
  description: string;
  category: string;
  visibility?: GlossaryVisibility;
  entries: GlossaryEntry[];
}

/** GET /api/glossary-invites/{token}. */
export interface GlossaryInvitePreview {
  /** `invite`: the caller can join. `member`: the link changes nothing for them. `revoked`: no join. */
  status: 'invite' | 'member' | 'revoked';
  glossaryId?: string;
  glossaryName: string;
  description?: string;
  /** The role the link grants. */
  linkRole?: GlossaryAssignableRole;
  /** The caller's current role, '' for none. */
  role: GlossaryRole | '';
}

export interface GlossaryRedeemResponse {
  linkId: string;
  glossaryId: string;
  glossaryName: string;
  role: GlossaryRole;
  alreadyMember: boolean;
}
