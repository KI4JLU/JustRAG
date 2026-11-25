/** Limits of a glossary (docs/api-contracts/translator.md): a name and a category in characters, the CSV file in bytes. */
export const GLOSSARY_LIMITS = {
  nameMax: 255,
  categoryMax: 255,
  importMaxBytes: 5 << 20,
} as const;
