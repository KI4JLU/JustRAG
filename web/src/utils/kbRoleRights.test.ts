import { describe, it, expect } from 'vitest';
import {
    KB_RIGHT_COLUMNS, KB_ROLE_ROWS, kbRightCell, sourceFlagsOf, sourceFlagsPatch, SOURCE_FLAG_DEFAULTS,
} from './kbRoleRights';
import type { KbSourceFlags } from '../types';

// Oracle: the source-permission spec (API.md "Source permissions", Sten's
// decisions of 2026-10-16) and the member route gates (kbAdminChain,
// kbaccess.Assignable), transcribed by hand below — not read back from the
// module. 'F' = fixed granted, '-' = fixed denied, otherwise the KB flag that
// decides the cell.
const SPEC: Record<string, Record<string, string>> = {
    owner: { invite: 'F', rights: 'F', seeSources: 'F', selectSources: 'F', downloadSources: 'F', editSources: 'F', seeCitations: 'F' },
    admin: { invite: 'F', rights: 'F', seeSources: 'F', selectSources: 'F', downloadSources: 'F', editSources: 'F', seeCitations: 'F' },
    edit: { invite: '-', rights: '-', seeSources: 'editorSeeSources', selectSources: 'editorSelectSources', downloadSources: 'editorDownloadSources', editSources: 'F', seeCitations: 'editorSeeCitations' },
    view: { invite: '-', rights: '-', seeSources: 'viewerSeeSources', selectSources: 'viewerSelectSources', downloadSources: 'viewerDownloadSources', editSources: '-', seeCitations: 'viewerSeeCitations' },
};

describe('kbRightCell', () => {
    for (const role of KB_ROLE_ROWS) {
        for (const col of KB_RIGHT_COLUMNS) {
            it(`${role} × ${col} matches the spec`, () => {
                const want = SPEC[role][col];
                const cell = kbRightCell(role, col);
                if (want === 'F') expect(cell).toMatchObject({ kind: 'fixed', granted: true });
                else if (want === '-') expect(cell).toEqual({ kind: 'fixed', granted: false });
                else expect(cell).toEqual({ kind: 'flag', flag: want });
            });
        }
    }

    it('binds every one of the eight flags to exactly one cell', () => {
        const bound = KB_ROLE_ROWS.flatMap(r => KB_RIGHT_COLUMNS.map(c => kbRightCell(r, c)))
            .flatMap(c => (c.kind === 'flag' ? [c.flag] : []));
        expect(bound.sort()).toEqual(Object.keys(SOURCE_FLAG_DEFAULTS).sort());
    });

    it('shows how far owner and admin reach when inviting and granting', () => {
        expect(kbRightCell('owner', 'invite')).toMatchObject({ scope: 'rrScopeAllRoles' });
        expect(kbRightCell('admin', 'rights')).toMatchObject({ scope: 'rrScopeUpToAdmin' });
    });
});

describe('sourceFlagsOf / sourceFlagsPatch', () => {
    it('falls back to the migration 0089 defaults (viewers off, editors on)', () => {
        expect(sourceFlagsOf({})).toEqual({
            viewerSeeSources: false, viewerSelectSources: false, viewerDownloadSources: false, viewerSeeCitations: false,
            editorSeeSources: true, editorSelectSources: true, editorDownloadSources: true, editorSeeCitations: true,
        });
        expect(sourceFlagsOf({ viewerSeeSources: true, editorSeeCitations: false }))
            .toMatchObject({ viewerSeeSources: true, editorSeeCitations: false });
    });

    it('patches only what changed, and nothing when nothing did', () => {
        const saved: KbSourceFlags = { ...SOURCE_FLAG_DEFAULTS };
        expect(sourceFlagsPatch(saved, { ...saved })).toBeNull();
        expect(sourceFlagsPatch(saved, { ...saved, viewerSeeSources: true, editorDownloadSources: false }))
            .toEqual({ viewerSeeSources: true, editorDownloadSources: false });
    });
});
