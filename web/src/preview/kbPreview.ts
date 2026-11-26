import axios from 'axios';
import { useSyncExternalStore } from 'react';
import type { KbPreviewRole, KbRole } from '../types';

/**
 * The KB preview ("Thema ansehen als Leser / Bearbeiter"): a KB admin or
 * owner sees one topic as a lower role. The server does the work — every
 * request for that topic carries `X-KB-Preview-Role` (API.md "Previewing a
 * KB as another role") and is answered as the previewed role, citations and
 * source lists included. This module only remembers which topic is
 * previewed as what, and adds the header.
 *
 * Not persisted: a reload ends the preview.
 */
export interface KbPreview {
  kbId: string;
  role: KbPreviewRole;
  /** The caller's own role on the topic, which the banner names („Du bleibst Besitzer"). */
  ownRole: KbRole;
}

export const PREVIEW_ROLE_HEADER = 'X-KB-Preview-Role';

let current: KbPreview | null = null;
let keepChat = false;
const listeners = new Set<() => void>();

export function getKbPreview(): KbPreview | null {
  return current;
}

/**
 * Starts, switches or ends the preview. A change normally returns the topic to
 * its start page (useKbPreviewSync); `keepChat` keeps the open chat instead,
 * for a change made by opening a chat from the history, which then shows.
 */
export function setKbPreview(next: KbPreview | null, opts?: { keepChat?: boolean }): void {
  if (current?.kbId === next?.kbId && current?.role === next?.role) return;
  current = next;
  keepChat = opts?.keepChat ?? false;
  listeners.forEach((l) => l());
}

/** Whether the last change keeps the open chat; reading it resets it. */
export function takeKeepChat(): boolean {
  const keep = keepChat;
  keepChat = false;
  return keep;
}

/**
 * Brings the preview in line with a chat about to open: a chat keeps the
 * preview it was started in (chats.preview_role), so opening one from the
 * history while the topic is previewed switches to that chat's preview, or
 * ends the preview for an ordinary chat. Chats of other topics end it
 * through the topic change.
 */
export function alignKbPreviewWithChat(chat: { kbId: string; previewRole?: KbPreviewRole | null }): void {
  if (!current || current.kbId !== chat.kbId) return;
  const role = chat.previewRole ?? null;
  if (role === current.role) return;
  setKbPreview(role ? { ...current, role } : null, { keepChat: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The preview in effect, re-rendering on every change. */
export function useKbPreview(): KbPreview | null {
  return useSyncExternalStore(subscribe, getKbPreview, getKbPreview);
}

/**
 * The preview header for a `method` request to `url`, or null. Requests for
 * the previewed topic's own routes (`/api/kb/<id>` and below) carry it, and
 * so do writes to a source file (`DELETE /api/files/<id>`, `POST …/retry`),
 * which the server then refuses: those name no topic, but only the open
 * topic's source list sends them. Reads of a file stay the caller's own — a
 * search hit can open another topic's source before the preview ends. The
 * topic lists, other topics and the account routes stay the caller's own.
 */
export function previewHeaderFor(url: string | undefined, method = 'GET'): string | null {
  if (!current || !url) return null;
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0];
  const prefix = `/api/kb/${current.kbId}`;
  if (path === prefix || path.startsWith(`${prefix}/`)) return current.role;
  if (path.startsWith('/api/files/') && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') return current.role;
  return null;
}

/**
 * Adds the header to axios requests and returns the cleanup. AppRoot installs
 * it next to its 401 interceptor; authFetch adds the header itself.
 */
export function installKbPreviewInterceptor(): () => void {
  const id = axios.interceptors.request.use((config) => {
    const role = previewHeaderFor(config.url, config.method);
    if (role) config.headers.set(PREVIEW_ROLE_HEADER, role);
    return config;
  });
  return () => axios.interceptors.request.eject(id);
}
