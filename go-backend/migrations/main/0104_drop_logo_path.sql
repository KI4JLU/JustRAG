-- +goose Up
-- The uploaded system logo is gone: the web app builds its logo and window
-- title from the design system's Logo and APP_NAME_PREFIX / APP_NAME_PRODUCT,
-- and the upload route, the /uploads/logo/ file serving and the public
-- logo_path key were removed with it. Delete the stored path so the admin
-- config surface stops listing a row nothing reads. The uploaded files under
-- uploads/logo/ are not touched; operators may delete them. Idempotent: a
-- deployment that never uploaded a logo deletes zero rows.
DELETE FROM site_configs WHERE key = 'logo_path';

-- +goose Down
-- Deliberately a no-op: no build after this one reads logo_path. Rolling back
-- to a build that still renders an uploaded logo means uploading it again.
SELECT 1;
