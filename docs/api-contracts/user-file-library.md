# User file library API contract (phase 1)

Backend: `go-backend/internal/userfiles`, `internal/files/from_library.go`, `internal/cascade`.
The frontend builds against this document. Everything here matches the merged code.

## Conventions

- All endpoints require authentication (same as the rest of `/api`). Unauthenticated: `401 {"error":"Authentication required"}`.
- JSON keys are camelCase. Optional values are omitted, never `null`.
- Every error body is `{"error": "<string>"}`, except the two structured ones (`quota_exceeded`, `already_in_kb`) below.
- Library endpoints are **owner-only**: a user only ever sees their own files, a superadmin included. Another owner's id and a malformed id both return `404 {"error":"File not found"}` (never 403).
- 500 errors carry a sanitized message; show a generic failure text.

## Shapes

```
UserFile = {
  id: string,            // uuid
  name: string,          // display name, editable via PATCH (1..255 bytes)
  mime: string,
  size: number,          // bytes
  createdAt: string,     // RFC 3339
  kbs: KBLink[]          // always present, [] when in no KB
}
KBLink  = { kbId: string, fileId: string, status: string }
          // fileId = the KB's indexed copy (files row); status = that copy's ingest
          // status (pending | processing | completed | partial | error).
          // partial = ingested, but some optional stages failed; the file is searchable, treat like completed
KBUsage = { id: string, name: string, visibility: "private"|"public", memberCount: number }
```

Not exposed: owner id, sha256, storage path.

## Library endpoints

### GET /api/library/files

Query: `limit` (default 50, clamped 1..500), `offset` (default 0, negatives ignored). Newest first.

200:
```json
{
  "items": [
    {"id":"7b0c9f64-2b1e-4a39-9d51-0a6a1f0e2c11","name":"report.pdf","mime":"application/pdf","size":482113,
     "createdAt":"2026-10-08T09:12:44Z",
     "kbs":[{"kbId":"3f2a8c10-5d7e-4b1a-8f3c-6e9d2a4b7c01","fileId":"91d4e6a2-0c3b-4f58-a7d1-2b8e5c9f3a10","status":"completed"}]}
  ],
  "total": 1
}
```
`items` is `[]` when empty. `total` is the unpaged count.

### POST /api/library/files

`multipart/form-data`, field `file`. Transport cap 500 MiB. Uploads into the library only (no KB, no indexing).

| Status | Body |
|---|---|
| 201 | `UserFile` (new file) |
| 200 | `UserFile` plus `"deduplicated": true`: this user already holds identical bytes; the existing file is returned, nothing is stored or charged to quota |
| 400 | `{"error":"Invalid multipart form"}`, `"File field is required"`, `"File must not be empty"`, `"File type not allowed"`, `"File type not supported (.ext)"`, `"Filename must not exceed 255 bytes"` |
| 413 | transport cap: `{"error":"File too large: the upload limit is 500 MiB"}`; spreadsheet gate: `{"error":"Spreadsheet too large (X): the limit is Y (tabular_max_file_bytes)"}` |
| 413 | quota: `{"error":"quota_exceeded","usedBytes":1048576000,"quotaBytes":1073741824}` |

201 example:
```json
{"id":"7b0c9f64-2b1e-4a39-9d51-0a6a1f0e2c11","name":"report.pdf","mime":"application/pdf","size":482113,"createdAt":"2026-10-08T09:12:44Z","kbs":[]}
```

Dedup is per user and by content hash. Different users uploading the same bytes each get their own file. The quota check happens before the hash is known (see "Quota semantics").

### GET /api/library/files/{id}

200 `UserFile`. 404 `{"error":"File not found"}`.

### PATCH /api/library/files/{id}

Body `{"name":"new name.pdf"}`. The name is trimmed. Renames the library entry only (KB copies keep their own names). The file extension cannot change (compared case-insensitively), and the new name must pass the upload filename rules (no dangerous or unsupported extension, at most 255 bytes): the extension decides which parser and size gate a KB copy gets.

200 `UserFile`. 400 `{"error":"invalid name"}` (empty/whitespace-only, longer than 255 bytes, changed or dangerous/unsupported extension, or unparseable body). 404.

### DELETE /api/library/files/{id}

**Removes the file from every KB it was added to** (each KB copy with its chunks, graph and tabular data), then the library entry and the blob. Irreversible.

204 no body. 404 `{"error":"File not found"}`. 500 on partial failure (the library entry is kept so the delete can be retried).

UI: before calling this, fetch `GET .../usage` and confirm with the user, listing the KBs. Deleting a user account deletes their whole library the same way: **KB uploads made after this release are library files of the uploader, so deleting that account removes them from every KB, public KBs included** (uploads from before this release are unaffected). An admin impact preview for this (`GET /api/admin/users/{id}/file-impact`, spec section 6) is **not** part of phase 1; the admin UI cannot show the consequence yet.

### GET /api/library/files/{id}/download

200 with the raw bytes, `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`, `Content-Type` = the file's mime. 404 `{"error":"File not found"}` (or `"File has no storage path"`). 500 `{"error":"Failed to read file"}`.

### GET /api/library/files/{id}/usage

KBs currently holding a copy (impact preview for the delete dialog). `memberCount` is the number of members of that KB.

200:
```json
{"kbs":[{"id":"3f2a8c10-5d7e-4b1a-8f3c-6e9d2a4b7c01","name":"Handbuch","visibility":"public","memberCount":14}]}
```
`kbs` is `[]` when unused. 404.

### GET /api/library/quota

200: `{"usedBytes":1048576,"quotaBytes":0}`. `quotaBytes: 0` means **unlimited**. `usedBytes` sums the library files' sizes; a file added to N KBs counts once.

## KB endpoints

### POST /api/kb/{id}/files (changed)

Auth: KB role `edit` or higher (unchanged). Multipart `file`. Validation, status codes, messages and the 201 `FileRecord` shape are unchanged, with these differences:

- The bytes now also land in the uploader's library (deduplicated, quota-charged). The 201 `FileRecord` gains `"userFileId": "<uuid>"`.
- New 413 `{"error":"quota_exceeded","usedBytes":N,"quotaBytes":M}` when the upload would exceed the uploader's library quota.
- New 409 when the KB already holds a copy of the same library file (same bytes, same uploader):
  `{"error":"already_in_kb","fileId":"<existing KB file id>"}`.
  `fileId` is present except in a rare concurrent-upload race, where the body is just `{"error":"already_in_kb"}`. Do not depend on `fileId`.

Quota gotcha: the quota is checked before the content hash is known. A user who is at their quota and re-uploads bytes they already own gets 413 (not 409, not a dedup). To add a file that is already in the library to a KB, call `POST /api/kb/{id}/files/from-library`, which never charges quota. Offer "add from library" in the UI rather than re-uploading.

### POST /api/kb/{id}/files/from-library

Auth: KB role `edit` or higher. Adds the caller's library files to the KB without re-uploading. Each added file becomes a new KB file that is ingested (chunked, embedded) as usual.

Request: `{"userFileIds":["7b0c9f64-2b1e-4a39-9d51-0a6a1f0e2c11","c1e2d3f4-1111-4a2b-9c3d-5e6f7a8b9c0d"]}` (1..100 ids).

200 (whenever the request itself is valid; per-id problems are reported in `skipped`):
```json
{
  "added":   [{"fileId":"91d4e6a2-0c3b-4f58-a7d1-2b8e5c9f3a10","userFileId":"7b0c9f64-2b1e-4a39-9d51-0a6a1f0e2c11"}],
  "skipped": [{"userFileId":"c1e2d3f4-1111-4a2b-9c3d-5e6f7a8b9c0d","reason":"already_in_kb"}]
}
```
Both arrays are always present (possibly empty). `reason`:

| reason | meaning |
|---|---|
| `not_found` | not in the caller's library (another owner's id and malformed ids land here too) |
| `already_in_kb` | the KB already holds this library file |
| `kb_full` | the KB's file-count cap (500; 1000 for public KBs) or 500 MB total-size cap would be exceeded |

Errors: 400 `{"error":"userFileIds must contain 1-100 ids"}`, 401, 403 (no `edit` role on the KB), 404 (unknown KB), 500 (`"failed to queue file for processing"`, `"Failed to create file record"`, `"Failed to check KB limits"`).

### Deleting a KB copy

`DELETE /api/files/{fileId}` (existing) removes only the KB copy; the library file stays. The KB file's `userFileId` links back to it: `GET /api/kb/{id}/files` rows carry `"userFileId": "<uuid>"` for library-backed copies (key omitted otherwise), visible to every role that can list files.

The 200 response of a deduplicated `POST /api/library/files` (bytes already in the library) lists the KBs the existing file is already in under `kbs`.

## Quota semantics

- Effective quota = per-user override (`users.file_quota_bytes`) if set, else the global site_config key `user_file_quota_bytes`; `0` = unlimited. The default is unlimited, so nothing changes until an operator sets one.
- Usage counts each library file once, regardless of how many KBs hold it. An upload that brings usage exactly to the quota is allowed; one byte over is rejected with 413.
- Checked on both `POST /api/library/files` and `POST /api/kb/{id}/files`.
- Frontend handoff: there is no admin-UI field for the global key or the per-user override yet. The override lives in `users.file_quota_bytes` (DB only for now). Always read the current limit from `GET /api/library/quota`.

## Not in phase 1

Text, URL, crawl and academic imports remain KB-scoped files (no `userFileId`, not in the library). Files uploaded before phase 1 are not library files. `parseStatus` / `parseError` do not exist (the phase-2 parse cache is internal and not exposed). KB-less chat is phase 3.

## Phase 2 note: faster completion

Phase 2 adds no API change. However, `POST …/from-library` copies (and uploads rerouted through the library) may now be completed by a server-side index copy: the KB file's status can reach `completed` quickly without passing through the usual stage progression (`stage_detail` steps). The frontend must not assume intermediate stages are ever observed.
