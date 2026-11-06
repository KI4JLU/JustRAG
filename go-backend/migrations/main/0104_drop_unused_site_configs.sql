-- +goose Up
-- Site settings nothing reads any more; their rows only kept appearing in the
-- admin config surface (and went back into every save of the settings form):
--
--   - logo_path: the uploaded system logo is gone. The web app builds its logo
--     and window title from the design system's Logo and the app name
--     (institution_name / system_name, else APP_NAME_PREFIX /
--     APP_NAME_PRODUCT); the upload route and the /uploads/logo/ file serving
--     were removed with it. Files under uploads/logo/ are not touched;
--     operators may delete them.
--   - chat_footer, kb_header, imprint, example_prompts: the chat footer, the
--     KB header text, the imprint and the site-wide example prompts. The chat
--     footer is a fixed text now, a topic has its own start page, and the
--     imprint is a link (imprintUrl). A global KB's own header text and
--     example prompts are columns of knowledge_bases and stay.
--   - web_proxy: never read by any server or worker; it could hold proxy
--     credentials.
--
-- And one setting whose meaning changes: system_name was the whole app name
-- („JLU RAG") and is now its second part, beside institution_name („JLU" +
-- „RAG"). Every value stored before this migration has the old meaning, so it
-- would show as „JLU [JLU RAG]"; deleting it falls back to APP_NAME_PRODUCT
-- until an admin enters the new part.
--
-- Idempotent: a deployment that never set them deletes zero rows.
DELETE FROM site_configs
WHERE key IN ('logo_path', 'chat_footer', 'kb_header', 'imprint', 'example_prompts', 'web_proxy', 'system_name');

-- +goose Down
-- Deliberately a no-op: no build after this one reads the removed keys, and an
-- old system_name would mislead it. Rolling back to a build that still shows
-- them means entering the values again.
SELECT 1;
