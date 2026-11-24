import { describe, it, expect } from 'vitest';
import {
    cellRequires, FLAG_IMPLIED_BY, FLAG_REQUIRES, KB_RIGHT_GROUPS, KB_RIGHTS, KB_ROLE_COLUMNS, kbRightCell, previewOnlyRoles,
    resolveRightCell, sourceFlagsOf, sourceFlagsPatch, SOURCE_FLAG_DEFAULTS,
} from './kbRoleRights';
import type { KbSourceFlags } from '../types';

// Oracle: the source-permission spec (API.md "Source permissions") and Sten's
// decisions and mockup of 2026-10-16, transcribed by hand below — not read
// back from the module:
//   - rights are rows in three groups (Thema / Quellen in der Sidebar /
//     Antworten); "Rechte vergeben" is gone;
//   - owner and admin always have every right; inviting reaches all roles
//     (owner) or up to admin (admin); editors and viewers cannot invite yet;
//   - selecting sources is no permission; adding is an editor flag, viewers
//     can neither add nor edit (not applicable); editing is fixed for editors;
//   - the pyramid: add, preview, download and edit need "see" of the same
//     role, citations need nothing;
//   - preview is its own right next to download, and the download includes
//     it (Sten, 2026-11-24).
// 'F' = fixed granted, 'F:<scope>' = fixed granted with that scope text,
// 'F<flag' = fixed granted while <flag> is on, '-' = fixed denied,
// 'na' = not applicable, otherwise the KB flag that decides the cell.
const SPEC: Record<string, Record<string, string>> = {
    owner: { invite: 'F:rrScopeAllRoles', seeSources: 'F', addSources: 'F', previewSources: 'F', downloadSources: 'F', editSources: 'F', seeCitations: 'F' },
    admin: { invite: 'F:rrScopeUpToAdmin', seeSources: 'F', addSources: 'F', previewSources: 'F', downloadSources: 'F', editSources: 'F', seeCitations: 'F' },
    edit: { invite: '-', seeSources: 'editorSeeSources', addSources: 'editorAddSources', previewSources: 'editorPreviewSources', downloadSources: 'editorDownloadSources', editSources: 'F<editorSeeSources', seeCitations: 'editorSeeCitations' },
    view: { invite: '-', seeSources: 'viewerSeeSources', addSources: 'na', previewSources: 'viewerPreviewSources', downloadSources: 'viewerDownloadSources', editSources: 'na', seeCitations: 'viewerSeeCitations' },
};

describe('layout model', () => {
    it('has three row groups in the mockup order, without "Rechte vergeben"', () => {
        expect(KB_RIGHT_GROUPS.map(g => [g.id, [...g.rights]])).toEqual([
            ['topic', ['invite']],
            ['sidebar', ['seeSources', 'addSources', 'previewSources', 'downloadSources', 'editSources']],
            ['answers', ['seeCitations']],
        ]);
        expect(KB_ROLE_COLUMNS).toEqual(['owner', 'admin', 'edit', 'view']);
    });
});

describe('kbRightCell', () => {
    for (const role of KB_ROLE_COLUMNS) {
        for (const right of KB_RIGHTS) {
            it(`${role} × ${right} matches the spec`, () => {
                const want = SPEC[role][right];
                const cell = kbRightCell(role, right);
                if (want === 'F') {
                    expect(cell).toMatchObject({ kind: 'fixed', granted: true });
                    expect(cellRequires(cell)).toBeUndefined();
                } else if (want.startsWith('F:')) {
                    expect(cell).toMatchObject({ kind: 'fixed', granted: true, scope: want.slice(2) });
                } else if (want.startsWith('F<')) {
                    expect(cell).toMatchObject({ kind: 'fixed', granted: true, requires: want.slice(2) });
                } else if (want === '-') {
                    expect(cell).toEqual({ kind: 'fixed', granted: false });
                } else if (want === 'na') {
                    expect(cell).toEqual({ kind: 'na' });
                } else {
                    expect(cell).toEqual({ kind: 'flag', flag: want });
                }
            });
        }
    }

    it('binds every one of the nine flags to exactly one cell', () => {
        const bound = KB_ROLE_COLUMNS.flatMap(r => KB_RIGHTS.map(c => kbRightCell(r, c)))
            .flatMap(c => (c.kind === 'flag' ? [c.flag] : []));
        expect(bound.sort()).toEqual(Object.keys(SOURCE_FLAG_DEFAULTS).sort());
    });
});

describe('the pyramid', () => {
    it('makes add, preview and download depend on "see" of the same role, citations on nothing', () => {
        expect(FLAG_REQUIRES).toEqual({
            viewerPreviewSources: 'viewerSeeSources',
            viewerDownloadSources: 'viewerSeeSources',
            editorAddSources: 'editorSeeSources',
            editorPreviewSources: 'editorSeeSources',
            editorDownloadSources: 'editorSeeSources',
        });
        expect(FLAG_IMPLIED_BY).toEqual({
            viewerPreviewSources: 'viewerDownloadSources',
            editorPreviewSources: 'editorDownloadSources',
        });
        expect(cellRequires(kbRightCell('edit', 'editSources'))).toBe('editorSeeSources');
        expect(cellRequires(kbRightCell('edit', 'seeCitations'))).toBeUndefined();
        expect(cellRequires(kbRightCell('view', 'addSources'))).toBeUndefined();
        expect(cellRequires(kbRightCell('admin', 'editSources'))).toBeUndefined();
    });

    it('resolves an editor without "see" to: nothing with sources, citations unaffected', () => {
        const flags = { ...SOURCE_FLAG_DEFAULTS, editorSeeSources: false };
        expect(resolveRightCell('edit', 'addSources', flags)).toEqual({ kind: 'flag', flag: 'editorAddSources', checked: false, blocked: true, implied: false });
        expect(resolveRightCell('edit', 'previewSources', flags)).toMatchObject({ checked: false, blocked: true, implied: false });
        expect(resolveRightCell('edit', 'downloadSources', flags)).toMatchObject({ checked: false, blocked: true });
        expect(resolveRightCell('edit', 'editSources', flags)).toMatchObject({ kind: 'fixed', granted: false, blocked: true });
        expect(resolveRightCell('edit', 'seeCitations', flags)).toMatchObject({ checked: true, blocked: false });
        expect(resolveRightCell('admin', 'editSources', flags)).toMatchObject({ kind: 'fixed', granted: true, blocked: false });
    });

    it('resolves a viewer with "see" on to an enabled download', () => {
        const flags = { ...SOURCE_FLAG_DEFAULTS, viewerSeeSources: true };
        expect(resolveRightCell('view', 'downloadSources', flags)).toEqual({ kind: 'flag', flag: 'viewerDownloadSources', checked: false, blocked: false, implied: false });
        expect(resolveRightCell('view', 'editSources', flags)).toEqual({ kind: 'na' });
    });

    it('shows the preview as granted and locked while the download is on', () => {
        const flags = { ...SOURCE_FLAG_DEFAULTS, viewerSeeSources: true, viewerDownloadSources: true, viewerPreviewSources: false };
        expect(resolveRightCell('view', 'previewSources', flags)).toEqual({ kind: 'flag', flag: 'viewerPreviewSources', checked: true, blocked: false, implied: true });
        const own = { ...flags, viewerDownloadSources: false };
        expect(resolveRightCell('view', 'previewSources', own)).toEqual({ kind: 'flag', flag: 'viewerPreviewSources', checked: false, blocked: false, implied: false });
    });

    it('lists the roles that preview without download (the not-a-protection warning)', () => {
        expect(previewOnlyRoles(SOURCE_FLAG_DEFAULTS)).toEqual([]);
        const viewerPreview = { ...SOURCE_FLAG_DEFAULTS, viewerSeeSources: true, viewerPreviewSources: true };
        expect(previewOnlyRoles(viewerPreview)).toEqual(['view']);
        expect(previewOnlyRoles({ ...viewerPreview, viewerDownloadSources: true })).toEqual([]);
        expect(previewOnlyRoles({ ...viewerPreview, viewerSeeSources: false })).toEqual([]);
        expect(previewOnlyRoles({ ...viewerPreview, editorDownloadSources: false })).toEqual(['edit', 'view']);
    });
});

describe('sourceFlagsOf / sourceFlagsPatch', () => {
    it('falls back to the migration 0089 / 0107 defaults (viewers off, editors on)', () => {
        expect(sourceFlagsOf({})).toEqual({
            viewerSeeSources: false, viewerPreviewSources: false, viewerDownloadSources: false, viewerSeeCitations: false,
            editorSeeSources: true, editorAddSources: true, editorPreviewSources: true, editorDownloadSources: true, editorSeeCitations: true,
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
