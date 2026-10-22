import { describe, it, expect } from 'vitest';
import { searchRows, sortRows, toLocalTable } from './localTable';

// Oracle: the cells as the Markdown answer shows them, written out by hand.
describe('toLocalTable', () => {
    it('types a column as number only when every non-empty cell is a plain decimal', () => {
        const t = toLocalTable([
            ['Posten', 'Anzahl', 'Betrag', 'Gemischt'],
            ['Einnahmen', '2', '1.5', '12 (2 + 10)'],
            ['Personal', '', '3.25', '4'],
        ], 'Spalte');
        expect(t.columns.map(c => [c.name, c.kind, c.decimals])).toEqual([
            ['Posten', 'text', 0], ['Anzahl', 'number', 0], ['Betrag', 'number', 2], ['Gemischt', 'text', 0],
        ]);
        expect(t.rows[0].cells).toEqual(['Einnahmen', 2, 1.5, '12 (2 + 10)']);
        expect(t.rows[1].cells).toEqual(['Personal', null, 3.25, '4']);
    });

    it('keeps locale-ambiguous numbers as text, verbatim', () => {
        const t = toLocalTable([['a'], ['1.234,5'], ['12,5']], 'Spalte');
        expect(t.columns[0].kind).toBe('text');
        expect(t.rows.map(r => r.cells[0])).toEqual(['1.234,5', '12,5']);
    });

    it('names empty and duplicate headers uniquely and pads short rows', () => {
        const t = toLocalTable([['', 'Wert', 'Wert'], ['x']], 'Spalte');
        expect(t.columns.map(c => c.name)).toEqual(['Spalte 1', 'Wert', 'Wert (2)']);
        expect(t.rows[0].cells).toEqual(['x', null, null]);
        expect(t.columns[1].empty).toBe(true);
    });

    it('never generates a name that another header already has', () => {
        const t = toLocalTable([['Wert', 'Wert', 'Wert (2)'], ['1', '2', '3']], 'Spalte');
        expect(t.columns.map(c => c.name)).toEqual(['Wert', 'Wert (3)', 'Wert (2)']);
    });

    it('keeps numbers a double cannot hold exactly as text', () => {
        const t = toLocalTable([['id', 'pi', 'ok'], ['9007199254740993', `0.${'1'.repeat(120)}`, '12345678901.2345']], 'Spalte');
        expect(t.columns.map(c => c.kind)).toEqual(['text', 'text', 'number']);
        expect(t.rows[0].cells.slice(0, 2)).toEqual(['9007199254740993', `0.${'1'.repeat(120)}`]);
        expect(t.columns[2].decimals).toBe(4);
    });

    it('keeps a dotted value that could be German thousands as text', () => {
        const t = toLocalTable([['de', 'en'], ['12.345', '0.345'], ['1.5', '2.50']], 'Spalte');
        expect(t.columns.map(c => c.kind)).toEqual(['text', 'number']);
        expect(t.rows[0].cells).toEqual(['12.345', 0.345]);
    });

    it('keeps zero-padded ids and long zero fractions as text', () => {
        const t = toLocalTable([['id', 'tiny', 'zero'], ['00123', `0.${'0'.repeat(101)}1`, '0.5']], 'Spalte');
        expect(t.columns.map(c => c.kind)).toEqual(['text', 'text', 'number']);
        expect(t.rows[0].cells).toEqual(['00123', `0.${'0'.repeat(101)}1`, 0.5]);
    });

    it('keeps every row as data when the table has no header row', () => {
        const t = toLocalTable([['a', '1'], ['b', '2', 'x']], 'Spalte', false);
        expect(t.columns.map(c => c.name)).toEqual(['Spalte 1', 'Spalte 2', 'Spalte 3']);
        expect(t.rows.map(r => r.cells)).toEqual([['a', 1, null], ['b', 2, 'x']]);
    });

    it('numbers rows from 1 in answer order', () => {
        const t = toLocalTable([['a'], ['x'], ['y']], 'Spalte');
        expect(t.rows.map(r => r.id)).toEqual([1, 2]);
    });
});

describe('searchRows / sortRows', () => {
    const t = toLocalTable([
        ['Schritt', 'Anzahl'],
        ['Schritt 10', '3'],
        ['Schritt 2', ''],
        ['Übereinstimmung', '12'],
    ], 'Spalte');

    it('matches the shown text case-insensitively', () => {
        expect(searchRows(t, [0, 1], 'übereinst', 'de-DE').map(r => r.id)).toEqual([3]);
        expect(searchRows(t, [0, 1], '  ', 'de-DE')).toBe(t.rows);
    });

    it('sorts text numeric-aware and numbers numerically, empty cells last both ways', () => {
        expect(sortRows(t, t.rows, { column: 'Schritt', dir: 'asc' }, 'de-DE').map(r => r.id)).toEqual([2, 1, 3]);
        expect(sortRows(t, t.rows, { column: 'Anzahl', dir: 'asc' }, 'de-DE').map(r => r.id)).toEqual([1, 3, 2]);
        expect(sortRows(t, t.rows, { column: 'Anzahl', dir: 'desc' }, 'de-DE').map(r => r.id)).toEqual([3, 1, 2]);
        expect(sortRows(t, t.rows, null, 'de-DE')).toBe(t.rows);
    });
});
