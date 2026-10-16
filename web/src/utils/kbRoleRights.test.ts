import { describe, it, expect } from 'vitest';
import {
    KB_RIGHT_COLUMNS, KB_ROLE_ROWS, kbRightCell, sourceFlagsOf, sourceFlagsPatch, SOURCE_FLAG_DEFAULTS,
} from './kbRoleRights';
import type { KbSourceFlags } from '../types';

// Oracle: KI-869's spec as documented in API.md "Source permissions" and the
// route gates in internal/app/routes.go, transcribed by hand below — not read
// back from the module. 'F' = fixed granted, '-' = fixed denied, otherwise
// the name of the KB flag that decides the cell.
const SPEC: Record<string, Record<string, string>> = {
    //        read  edit                   members rights seeSources          selectSources          downloadSources          seeCitations
    owner: { read: 'F', edit: 'F', members: 'F', rights: 'F', seeSources: 'F', selectSources: 'F', downloadSources: 'F', seeCitations: 'F' },
    admin: { read: 'F', edit: 'F', members: 'F', rights: 'F', seeSources: 'F', selectSources: 'F', downloadSources: 'F', seeCitations: 'F' },
    edit: { read: 'F', edit: 'editorManageSources', members: '-', rights: '-', seeSources: 'F', selectSources: 'F', downloadSources: 'F', seeCitations: 'F' },
    view: { read: 'F', edit: '-', members: '-', rights: '-', seeSources: 'viewerSeeSources', selectSources: 'viewerSelectSources', downloadSources: 'viewerDownloadSources', seeCitations: 'viewerSeeCitations' },
};

describe('kbRightCell', () => {
    for (const role of KB_ROLE_ROWS) {
        for (const col of KB_RIGHT_COLUMNS) {
            it(`${role} × ${col} matches the spec`, () => {
                const want = SPEC[role][col];
                const cell = kbRightCell(role, col);
                if (want === 'F') expect(cell).toEqual({ kind: 'fixed', granted: true });
                else if (want === '-') expect(cell).toEqual({ kind: 'fixed', granted: false });
                else expect(cell).toEqual({ kind: 'flag', flag: want });
            });
        }
    }

    it('binds every one of the five flags to exactly one cell', () => {
        const bound = KB_ROLE_ROWS.flatMap(r => KB_RIGHT_COLUMNS.map(c => kbRightCell(r, c)))
            .flatMap(c => (c.kind === 'flag' ? [c.flag] : []));
        expect(bound.sort()).toEqual(Object.keys(SOURCE_FLAG_DEFAULTS).sort());
    });
});

describe('sourceFlagsOf / sourceFlagsPatch', () => {
    it('falls back to the migration 0089 defaults (viewer off, editor on)', () => {
        expect(sourceFlagsOf({})).toEqual({
            viewerSeeSources: false, viewerSelectSources: false, viewerDownloadSources: false,
            viewerSeeCitations: false, editorManageSources: true,
        });
        expect(sourceFlagsOf({ viewerSeeSources: true }).viewerSeeSources).toBe(true);
    });

    it('patches only what changed, and nothing when nothing did', () => {
        const saved: KbSourceFlags = { ...SOURCE_FLAG_DEFAULTS };
        expect(sourceFlagsPatch(saved, { ...saved })).toBeNull();
        expect(sourceFlagsPatch(saved, { ...saved, viewerSeeSources: true, editorManageSources: false }))
            .toEqual({ viewerSeeSources: true, editorManageSources: false });
    });
});
