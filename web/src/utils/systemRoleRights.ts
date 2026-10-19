/**
 * The admin panel's "Rollen & Rechte" overview: what each SYSTEM role may do
 * (users.role — auth.RoleUser / RoleAPIUser / RoleAdmin / RoleSuperAdmin in
 * go-backend/internal/auth/roles.go). Read-only, and the single source of truth
 * for that table in the web code.
 *
 * There is no role→permission table in the backend: every gate is an inline
 * role list on a route chain in go-backend/internal/app/routes.go —
 *   superadminChain = auth.RoleChain(superadmin)
 *   adminChain      = auth.RoleChain(admin, superadmin)
 *   apiKeyChain     = auth.RoleChain(admin, superadmin, api-user)
 *   kbAdvancedChain = RequireRole(api-user, admin) + RequireKBRole(admin)
 *   plain Authenticate = every signed-in user
 * and auth.Middleware.RequireRole lets a superadmin through every one of them
 * (the hoisted bypass in internal/auth/middleware.go). Each right below names
 * the routes whose gate it mirrors; change the entry when the gate changes.
 */
export type SystemRole = 'superadmin' | 'admin' | 'api-user' | 'user';

export type SystemRight =
    // GET /api/admin/users, PATCH /api/admin/users/{id}/role (adminChain).
    // adminusers.UpdateUserRole narrows an admin: assigns only user/api-user
    // and cannot change an admin's or superadmin's role.
    | 'manageUsers'
    // PATCH /api/admin/users/{id}/role with role=admin: only a superadmin's
    // assignable set contains it. No caller can assign superadmin.
    | 'appointAdmins'
    // DELETE /api/admin/users/{id} (superadminChain).
    | 'deleteUsers'
    // POST /api/kb (Authenticate only).
    | 'createPrivateTopic'
    // /api/admin/global-kbs…, POST /api/admin/kb/{id}/publish|unpublish,
    // GET …/unpublish-impact, /api/admin/kb-categories… (adminChain).
    | 'manageGlobalTopics'
    // kbAdvancedChain: /api/kb/{id}/settings…, /agents/{agentId},
    // /teams/{teamId}, /eval/…, /workflow…, POST /reembed — system role
    // api-user/admin AND KB role admin; superadmin is owner of every topic,
    // so it always passes.
    | 'advancedTopicSettings'
    // DELETE /api/admin/kbs/{id}, PATCH /api/admin/kbs/{id}/owner
    // (superadminChain).
    | 'manageAnyTopic'
    // POST/GET/DELETE /api/api-keys (apiKeyChain).
    | 'apiAccess'
    // /api/admin/configs…, /api/admin/auth-providers… (adminChain).
    | 'aiModelsAuth'
    // GET /api/admin/kb-overview, /api/system-health/…, GET /metrics,
    // GET /api/admin/agent-metrics, GET /api/admin/feedback/chunks,
    // /api/admin/mcp/… (adminChain).
    | 'monitoring'
    // POST /api/site-config, POST /api/site-config/logo,
    // POST /api/admin/reembed-all, /reembed-user-memory, /agent/template
    // (superadminChain); the Suchanbieter / Agenten / Einstellungen tabs.
    | 'systemSettings'
    // GET /api/admin/audit-logs (superadminChain).
    | 'auditLogs';

export type SystemRightGroupId = 'users' | 'topics' | 'system';

/** Row groups as rendered. */
export const SYSTEM_RIGHT_GROUPS: readonly { id: SystemRightGroupId; rights: readonly SystemRight[] }[] = [
    { id: 'users', rights: ['manageUsers', 'appointAdmins', 'deleteUsers'] },
    { id: 'topics', rights: ['createPrivateTopic', 'manageGlobalTopics', 'advancedTopicSettings', 'manageAnyTopic'] },
    { id: 'system', rights: ['apiAccess', 'aiModelsAuth', 'monitoring', 'systemSettings', 'auditLogs'] },
];

export const SYSTEM_RIGHTS: readonly SystemRight[] = SYSTEM_RIGHT_GROUPS.flatMap(g => g.rights);

/** Columns left to right: strongest role first. */
export const SYSTEM_ROLE_COLUMNS: readonly SystemRole[] = ['superadmin', 'admin', 'api-user', 'user'];

/** The role that passes every gate (shown as a muted column with plain marks). */
export const SYSTEM_ALWAYS_ALL_ROLE: SystemRole = 'superadmin';

/**
 * The routes each right mirrors, shown in the row's hint. Not translated:
 * these are the literal routes in routes.go.
 */
export const SYSTEM_RIGHT_ROUTES: Record<SystemRight, readonly string[]> = {
    manageUsers: ['GET /api/admin/users', 'PATCH /api/admin/users/{id}/role'],
    appointAdmins: ['PATCH /api/admin/users/{id}/role (role: admin)'],
    deleteUsers: ['DELETE /api/admin/users/{id}'],
    createPrivateTopic: ['POST /api/kb'],
    manageGlobalTopics: ['/api/admin/global-kbs', '/api/admin/kb/{id}/publish', '/api/admin/kb/{id}/unpublish', '/api/admin/kb-categories'],
    advancedTopicSettings: ['/api/kb/{id}/settings', '/api/kb/{id}/agents/{agentId}', '/api/kb/{id}/teams/{teamId}', '/api/kb/{id}/eval', '/api/kb/{id}/workflow', 'POST /api/kb/{id}/reembed'],
    manageAnyTopic: ['DELETE /api/admin/kbs/{id}', 'PATCH /api/admin/kbs/{id}/owner'],
    apiAccess: ['/api/api-keys'],
    aiModelsAuth: ['/api/admin/configs', '/api/admin/auth-providers'],
    monitoring: ['/api/admin/kb-overview', '/api/system-health', '/metrics', '/api/admin/agent-metrics'],
    systemSettings: ['POST /api/site-config', 'POST /api/site-config/logo', '/api/admin/reembed-all'],
    auditLogs: ['GET /api/admin/audit-logs'],
};

/**
 * One cell: granted or not, and for a granted one optionally the translation
 * key of the text it shows instead of a check mark (how far the right reaches,
 * e.g. "bis API-Nutzer").
 */
export interface SystemRightCell {
    granted: boolean;
    scope?: string;
}

const yes = (scope?: string): SystemRightCell => (scope ? { granted: true, scope } : { granted: true });
const no: SystemRightCell = { granted: false };

const MATRIX: Record<SystemRole, Record<SystemRight, SystemRightCell>> = {
    superadmin: {
        manageUsers: yes(), appointAdmins: yes(), deleteUsers: yes(),
        createPrivateTopic: yes(), manageGlobalTopics: yes(), advancedTopicSettings: yes(), manageAnyTopic: yes(),
        apiAccess: yes(), aiModelsAuth: yes(), monitoring: yes(), systemSettings: yes(), auditLogs: yes(),
    },
    admin: {
        manageUsers: yes('arScopeUpToApiUser'), appointAdmins: no, deleteUsers: no,
        createPrivateTopic: yes(), manageGlobalTopics: yes(), advancedTopicSettings: yes('arScopeAsTopicAdmin'), manageAnyTopic: no,
        apiAccess: yes(), aiModelsAuth: yes(), monitoring: yes(), systemSettings: no, auditLogs: no,
    },
    'api-user': {
        manageUsers: no, appointAdmins: no, deleteUsers: no,
        createPrivateTopic: yes(), manageGlobalTopics: no, advancedTopicSettings: yes('arScopeAsTopicAdmin'), manageAnyTopic: no,
        apiAccess: yes(), aiModelsAuth: no, monitoring: no, systemSettings: no, auditLogs: no,
    },
    user: {
        manageUsers: no, appointAdmins: no, deleteUsers: no,
        createPrivateTopic: yes(), manageGlobalTopics: no, advancedTopicSettings: no, manageAnyTopic: no,
        apiAccess: no, aiModelsAuth: no, monitoring: no, systemSettings: no, auditLogs: no,
    },
};

export function systemRightCell(role: SystemRole, right: SystemRight): SystemRightCell {
    return MATRIX[role][right];
}

/** Users per system role; roles outside the four (and malformed rows) are not counted. */
export function countUsersByRole(users: unknown): Record<SystemRole, number> {
    const out: Record<SystemRole, number> = { superadmin: 0, admin: 0, 'api-user': 0, user: 0 };
    if (!Array.isArray(users)) return out;
    for (const u of users) {
        const role = (u as { role?: unknown } | null)?.role;
        if (typeof role === 'string' && role in out) out[role as SystemRole] += 1;
    }
    return out;
}
