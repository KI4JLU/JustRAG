import { describe, it, expect } from 'vitest';
import {
    countUsersByRole, SYSTEM_ALWAYS_ALL_ROLE, SYSTEM_RIGHT_GROUPS, SYSTEM_RIGHT_ROUTES, SYSTEM_RIGHTS,
    SYSTEM_ROLE_COLUMNS, systemRightCell,
} from './systemRoleRights';

// Oracle: go-backend/internal/app/routes.go and internal/adminusers/handler.go
// as read by hand on 2026-10-19, transcribed below — not read back from the
// module:
//   - superadminChain: DELETE /api/admin/users/{id}, DELETE /api/admin/kbs/{id},
//     PATCH /api/admin/kbs/{id}/owner, GET /api/admin/audit-logs,
//     POST /api/site-config(/logo), POST /api/admin/reembed-*;
//   - adminChain (admin + superadmin): /api/admin/users (list, role change),
//     /api/admin/global-kbs…, /api/admin/kb/{id}/publish|unpublish,
//     /api/admin/kb-categories…, /api/admin/configs…, /api/admin/auth-providers…,
//     kb-overview, system-health, /metrics, agent-metrics;
//   - apiKeyChain: admin, superadmin, api-user;
//   - kbAdvancedChain: api-user or admin (superadmin bypasses) AND KB admin;
//   - POST /api/kb: Authenticate only;
//   - UpdateUserRole: a superadmin assigns user/api-user/admin, an admin only
//     user/api-user and never touches an admin/superadmin; nobody assigns
//     superadmin.
// 'Y' = granted with a check mark, 'Y:<key>' = granted with that scope text,
// '-' = not granted.
const SPEC: Record<string, Record<string, string>> = {
    superadmin: {
        manageUsers: 'Y', appointAdmins: 'Y', deleteUsers: 'Y',
        createPrivateTopic: 'Y', manageGlobalTopics: 'Y', advancedTopicSettings: 'Y', manageAnyTopic: 'Y',
        apiAccess: 'Y', aiModelsAuth: 'Y', monitoring: 'Y', systemSettings: 'Y', auditLogs: 'Y',
    },
    admin: {
        manageUsers: 'Y:arScopeUpToApiUser', appointAdmins: '-', deleteUsers: '-',
        createPrivateTopic: 'Y', manageGlobalTopics: 'Y', advancedTopicSettings: 'Y:arScopeAsTopicAdmin', manageAnyTopic: '-',
        apiAccess: 'Y', aiModelsAuth: 'Y', monitoring: 'Y', systemSettings: '-', auditLogs: '-',
    },
    'api-user': {
        manageUsers: '-', appointAdmins: '-', deleteUsers: '-',
        createPrivateTopic: 'Y', manageGlobalTopics: '-', advancedTopicSettings: 'Y:arScopeAsTopicAdmin', manageAnyTopic: '-',
        apiAccess: 'Y', aiModelsAuth: '-', monitoring: '-', systemSettings: '-', auditLogs: '-',
    },
    user: {
        manageUsers: '-', appointAdmins: '-', deleteUsers: '-',
        createPrivateTopic: 'Y', manageGlobalTopics: '-', advancedTopicSettings: '-', manageAnyTopic: '-',
        apiAccess: '-', aiModelsAuth: '-', monitoring: '-', systemSettings: '-', auditLogs: '-',
    },
};

describe('layout model', () => {
    it('has the four system roles, strongest first', () => {
        expect(SYSTEM_ROLE_COLUMNS).toEqual(['superadmin', 'admin', 'api-user', 'user']);
    });

    it('groups the rights as users / topics / system', () => {
        expect(SYSTEM_RIGHT_GROUPS.map(g => [g.id, [...g.rights]])).toEqual([
            ['users', ['manageUsers', 'appointAdmins', 'deleteUsers']],
            ['topics', ['createPrivateTopic', 'manageGlobalTopics', 'advancedTopicSettings', 'manageAnyTopic']],
            ['system', ['apiAccess', 'aiModelsAuth', 'monitoring', 'systemSettings', 'auditLogs']],
        ]);
    });

    it('names at least one mirrored route per right', () => {
        for (const right of SYSTEM_RIGHTS) expect(SYSTEM_RIGHT_ROUTES[right].length).toBeGreaterThan(0);
    });
});

describe('systemRightCell', () => {
    for (const role of SYSTEM_ROLE_COLUMNS) {
        for (const right of SYSTEM_RIGHTS) {
            it(`${role} × ${right} matches routes.go`, () => {
                const want = SPEC[role][right];
                const cell = systemRightCell(role, right);
                if (want === 'Y') expect(cell).toEqual({ granted: true });
                else if (want.startsWith('Y:')) expect(cell).toEqual({ granted: true, scope: want.slice(2) });
                else expect(cell).toEqual({ granted: false });
            });
        }
    }

    it('gives the superadmin every right (RequireRole bypass)', () => {
        expect(SYSTEM_ALWAYS_ALL_ROLE).toBe('superadmin');
        for (const right of SYSTEM_RIGHTS) expect(systemRightCell('superadmin', right).granted).toBe(true);
    });

    it('covers exactly the spec, no more rights than it names', () => {
        expect([...SYSTEM_RIGHTS].sort()).toEqual(Object.keys(SPEC.user).sort());
    });
});

describe('countUsersByRole', () => {
    it('counts each known role and ignores unknown or malformed rows', () => {
        expect(countUsersByRole([
            { role: 'user' }, { role: 'user' }, { role: 'admin' }, { role: 'superadmin' },
            { role: 'api-user' }, { role: 'guest' }, { role: 42 }, null, {},
        ])).toEqual({ superadmin: 1, admin: 1, 'api-user': 1, user: 2 });
    });

    it('returns zeros for a non-array payload', () => {
        expect(countUsersByRole({})).toEqual({ superadmin: 0, admin: 0, 'api-user': 0, user: 0 });
        expect(countUsersByRole(undefined)).toEqual({ superadmin: 0, admin: 0, 'api-user': 0, user: 0 });
    });
});
