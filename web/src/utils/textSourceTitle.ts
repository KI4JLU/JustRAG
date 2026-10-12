/**
 * The stored name of a „Text einfügen" source. The editor writes markdown,
 * but `POST /api/kb/{id}/text` stores every text source as text/plain under
 * its title; the `.md` suffix is what marks it as markdown for the preview,
 * so older plain-text sources (no suffix) keep showing literally.
 * Empty stays undefined — the endpoint rejects a missing title itself.
 */
export function markdownSourceTitle(title: string): string | undefined {
  const trimmed = title.trim();
  if (!trimmed) return undefined;
  return /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}
