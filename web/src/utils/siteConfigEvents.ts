/**
 * Window event an admin save of site-config keys dispatches, with the saved
 * keys as `detail`. AppRoot owns the app's copy and merges them in — the same
 * route `auth:unauthorized` takes, since AdminUI also renders outside the
 * provider tree in its tests.
 */
export const SITE_CONFIG_UPDATED_EVENT = 'site-config:updated';
