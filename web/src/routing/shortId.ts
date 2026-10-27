/*
 * Ids in URLs: a UUID's 16 bytes as 22 base64url characters instead of its
 * 36-character text form. Lossless both ways, so it identifies exactly what
 * the UUID does and is just as unguessable; only the URL layer
 * (routing/navigation.ts) encodes and decodes, everything else keeps UUIDs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT = /^[A-Za-z0-9_-]{22}$/;

/** A UUID as its 22-character URL form. Anything that is not a UUID is returned unchanged. */
export function toShortId(uuid: string): string {
  if (!UUID.test(uuid)) return uuid;
  const hex = uuid.replace(/-/g, '');
  let binary = '';
  for (let i = 0; i < 32; i += 2) binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The UUID a URL segment names: its 22-character form, or — for a link
 * written by hand — the UUID itself. Null for anything else.
 */
export function fromShortId(segment: string): string | null {
  if (UUID.test(segment)) return segment.toLowerCase();
  if (!SHORT.test(segment)) return null;
  const binary = atob(segment.replace(/-/g, '+').replace(/_/g, '/') + '==');
  let hex = '';
  for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
