/** Spreadsheet sources: the formats the tabular ingest reads (xlsx/xls/ods via excelize, csv/tsv). */
const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls', '.ods', '.csv', '.tsv'];

export const isSpreadsheetFile = (name: string): boolean => {
    const lower = name.toLowerCase();
    return SPREADSHEET_EXTENSIONS.some(ext => lower.endsWith(ext));
};
