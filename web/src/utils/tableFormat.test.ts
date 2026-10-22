import { describe, it, expect } from 'vitest';
import {
    columnDecimals, columnKind, columnLabel, formatCell, humanize, nextSort, parseCell, rowToJson, rowToMarkdown,
} from './tableFormat';

// Oracle: the handoff's formatting rules (HANDOFF.md "Spalten"), written out
// as literal expected strings — de-DE, fixed decimals per column (max 2),
// grouping only from 10 000 so years stay "1968".
describe('formatCell', () => {
    it('keeps years ungrouped and groups from 10 000', () => {
        expect(formatCell(1968, 'number', 0, 'de-DE')).toBe('1968');
        expect(formatCell(9999, 'number', 0, 'de-DE')).toBe('9999');
        expect(formatCell(12345, 'number', 0, 'de-DE')).toBe('12.345');
    });

    it('applies the column decimals with a decimal comma', () => {
        expect(formatCell(3.2, 'number', 1, 'de-DE')).toBe('3,2');
        expect(formatCell(2, 'number', 1, 'de-DE')).toBe('2,0');
    });

    it('leaves text alone and renders NULL as empty', () => {
        expect(formatCell('95 -100%', 'text', 0, 'de-DE')).toBe('95 -100%');
        expect(formatCell(null, 'number', 2, 'de-DE')).toBe('');
    });
});

describe('columnDecimals', () => {
    it('takes the most decimals in the column, capped at 2', () => {
        expect(columnDecimals([3.2, 2, null, 'x'])).toBe(1);
        expect(columnDecimals([1.23456])).toBe(2);
        expect(columnDecimals([1968, 2004])).toBe(0);
    });
});

describe('nextSort', () => {
    it('cycles ascending → descending → off, and restarts on another column', () => {
        const asc = nextSort(null, 'baujahr');
        expect(asc).toEqual({ column: 'baujahr', dir: 'asc' });
        const desc = nextSort(asc, 'baujahr');
        expect(desc).toEqual({ column: 'baujahr', dir: 'desc' });
        expect(nextSort(desc, 'baujahr')).toBeNull();
        expect(nextSort(desc, 'nr')).toEqual({ column: 'nr', dir: 'asc' });
    });
});

describe('columns', () => {
    it('maps the materialized SQL types to text / number', () => {
        expect(['numeric', 'bigint', 'double precision'].map(columnKind)).toEqual(['number', 'number', 'number']);
        expect(['text', 'date', 'boolean'].map(columnKind)).toEqual(['text', 'text', 'text']);
    });

    it('prefers the stored original header, else humanizes the SQL name', () => {
        expect(columnLabel('gebaeudebezeichnung_gebid', 'Gebäudebezeichnung / GebID')).toBe('Gebäudebezeichnung / GebID');
        expect(columnLabel('gebaeudebezeichnung_gebid', '  ')).toBe('Gebäudebezeichnung GebID');
        expect(humanize('note_heizung_lueftung')).toBe('Note Heizung Lüftung');
    });

    it('parses SQL text into typed cells', () => {
        expect(parseCell('3.2', 'number')).toBe(3.2);
        expect(parseCell('1968', 'number')).toBe(1968);
        expect(parseCell('n/a', 'number')).toBe('n/a');
        expect(parseCell(null, 'text')).toBeNull();
    });
});

describe('row copy formats', () => {
    it('writes JSON keyed by SQL name and a one-row Markdown table', () => {
        expect(JSON.parse(rowToJson(['nr', 'name'], [1, null]))).toEqual({ nr: 1, name: null });
        expect(rowToMarkdown(['nr', 'name'], [1, 'a|b'])).toBe('| nr | name |\n| --- | --- |\n| 1 | a\\|b |');
    });

    it('escapes pipes in headers too (an answer table header can carry one)', () => {
        expect(rowToMarkdown(['A|B'], ['x'])).toBe('| A\\|B |\n| --- |\n| x |');
    });
});

// Codex review of the UI: integers past 2^53 must not lose digits.
describe('parseCell with large integers', () => {
    it('keeps an integer beyond the safe range as its exact text', () => {
        expect(parseCell('9007199254740993', 'number')).toBe('9007199254740993');
        expect(parseCell('9007199254740991', 'number')).toBe(9007199254740991);
    });
});
