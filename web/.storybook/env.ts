/**
 * Storybook and the Vitest browser runner serve the app from their OWN origin
 * and there is no backend behind it. These two settings make the app resolve
 * its API base to that origin, deterministically, on any machine.
 *
 * src/api.ts derives API_BASE_URL as: `VITE_API_URL` if set, else
 * `http://localhost:3001` whenever `import.meta.env.DEV`, else `''`. Storybook
 * dev and the browser test runner are both dev-mode builds, so left alone
 * every story points at a backend that is not running. Two concrete
 * consequences, both of them states this card exists to show:
 *   - the uploaded-logo branch renders `<img src={API_BASE_URL + logo_path}>`,
 *     which would be a broken image instead of a logo;
 *   - `GET {API_BASE_URL}/api/auth/providers` would come out cross-origin,
 *     i.e. not the production URL shape the story-level mock matches on.
 *
 * ENV PREFIX — why the define alone is not enough. Vite loads `.env*` from its
 * root and replaces `import.meta.env.VITE_*` with those values BEFORE user
 * `define` is applied, so a developer's own git-ignored web/.env.local silently
 * wins. That is not hypothetical: this checkout had
 * `VITE_API_URL=http://localhost:3000` in web/.env.local, and with the define
 * in place the logo still requested http://localhost:3000/logo-test.svg
 * (measured, twice). Narrowing `envPrefix` to a prefix nothing in this repo
 * uses means Vite exposes no `VITE_*` variable to the workbench at all, so
 * there is nothing to replace and the define below applies. Stories then look
 * the same on every machine. `npm run dev` and `npm run build` are unaffected:
 * this is Storybook's config, not the app's.
 * (`envDir` pointed at .storybook/ was tried first and did NOT stop the local
 * .env.local from winning — hence the prefix and not the directory.)
 *
 * DEFINE — a raw expression, not a string literal, because the origin is not
 * known when the config is written: Storybook dev listens on 6006, a
 * `storybook build` bundle is served from wherever it is opened, and the
 * Vitest browser runner picks a free port. `window.location.origin` is correct
 * in all three, and it reduces the request to the same same-origin `/api/...`
 * path production uses.
 */
export const STORYBOOK_ENV_PREFIX = 'SB_STORY_';

export const STORYBOOK_ENV_DEFINE: Record<string, string> = {
  'import.meta.env.VITE_API_URL': 'window.location.origin',
};
