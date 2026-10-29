/** The parts of a global KB row the „Entdecken" card is built from. */
export interface CardSource {
    description?: string | null;
    headerText?: string | null;
    fileCount?: number;
    lastIngestedAt?: string | null;
}

/**
 * The fields of the „Entdecken" card (KbCatalogPanel) this KB leaves empty, as
 * translation keys: the category, an own description (without one the card
 * shows the header text, else the generic default line, as the start page
 * does), the documents and their „Stand". `null` categories mean
 * they failed to load — then nothing is claimed about them.
 */
export function missingCardFields(kb: CardSource, categoryIds: string[] | null): string[] {
    const missing: string[] = [];
    if (categoryIds !== null && categoryIds.length === 0) missing.push('globalKbMissingCategory');
    if (!kb.description?.trim() && !kb.headerText?.trim()) missing.push('globalKbMissingDescription');
    if (!kb.fileCount) missing.push('globalKbMissingDocuments');
    else if (!kb.lastIngestedAt) missing.push('globalKbMissingAsOf');
    return missing;
}
