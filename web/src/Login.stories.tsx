import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import Login from './Login';

/* ---------------------------------------------------------------------------
 * The login page's rendered state comes from ONE network response, so these
 * stories set that response and nothing else (card KI-725).
 *
 * `providers` / `localAuthEnabled` are NOT props. Login fetches
 * GET /api/auth/providers on mount and derives everything visible from it:
 *   oidcProvider    = providers.find(p => p.type === 'oidc')
 *   ldapActive      = providers.some(p => p.type === 'ldap')
 *   showPasswordForm = isAdminRoute || (loaded && (localAuthEnabled || ldapActive))
 *   showOidcButton   = !isAdminRoute && loaded && oidcProvider !== null
 * They are therefore supplied through `parameters.api.authProviders`, which
 * .storybook/mockApi.ts answers at axios's transport layer — see that file for
 * what is and is not real about that interception.
 *
 * `siteConfigs` IS a prop and is a genuine story arg.
 *
 * isAdminRoute: Login reads `window.location.pathname === '/admin'` and, when
 * true, hard-hides the SSO button and force-shows the password form. Storybook
 * serves stories from /iframe.html and the Vitest browser runner from its own
 * path, so `isAdminRoute` is false in every story below — which is the branch
 * these six states are about. The /admin breakglass view cannot be reached
 * from a story without navigating the page and is deliberately not covered
 * here; it is what `Login.test.tsx` already asserts in jsdom, where the
 * pathname can be pushed.
 *
 * Light mode only: no story pins a theme. The toolbar's Theme switch renders
 * any story dark without reloading — see .storybook/preview.tsx. Dark-mode
 * coverage is an accessibility question, not one story per state.
 * ------------------------------------------------------------------------- */

const OIDC = { id: 'p1', type: 'oidc', name: 'JLU Single Sign-On' };
const LDAP = { id: 'l1', type: 'ldap', name: 'JLU LDAP' };

const meta = {
  title: 'Pages/Login',
  component: Login,
  // AuthLayout supplies `min-h-dvh … bg-surface`, so the story must render
  // edge to edge or the page background and centring are both wrong.
  parameters: { layout: 'fullscreen' },
  args: {
    onLogin: fn(),
    siteConfigs: {},
  },
} satisfies Meta<typeof Login>;

export default meta;
type Story = StoryObj<typeof meta>;

/** SSO only — the state the developer had to fake in DevTools to review. */
export const SsoOnly: Story = {
  tags: ['a11y-dark'],
  parameters: {
    api: { authProviders: { providers: [OIDC], localAuthEnabled: false } },
  },
};

/** Password only: no OIDC provider, local auth on. */
export const PasswordOnly: Story = {
  parameters: {
    api: { authProviders: { providers: [], localAuthEnabled: true } },
  },
};

/**
 * Both methods — and with them the open TWO-PRIMARIES question: the submit
 * button and the SSO link are both `variant="default"`, so the page shows two
 * equally weighted primary actions. This story exists so that decision is
 * looked at rather than described.
 */
export const PasswordAndSso: Story = {
  parameters: {
    api: { authProviders: { providers: [OIDC], localAuthEnabled: true } },
  },
};

/** LDAP is the other route to the password form (no `localAuthEnabled`). */
export const LdapOnly: Story = {
  parameters: {
    api: { authProviders: { providers: [LDAP], localAuthEnabled: false } },
  },
};

/**
 * Operator-uploaded logo — what production currently shows, because a
 * deployment with `logo_path` set never reaches the design system's `Logo`
 * fallback (card KI-719). Every other story here has `siteConfigs: {}` and so
 * shows the DS wordmark, which is the comparison.
 *
 * /logo-test.svg is the repo's own fixture in web/public, served by Storybook's
 * staticDirs and by Vite's publicDir in the test run — a real HTTP fetch, not
 * a data URI.
 */
export const UploadedLogo: Story = {
  args: { siteConfigs: { logo_path: '/logo-test.svg' } },
  parameters: {
    api: { authProviders: { providers: [OIDC], localAuthEnabled: false } },
  },
  play: async ({ canvas }) => {
    const logo = await canvas.findByAltText('Site Logo');
    // Oracle: the browser's own image decoder, not this repo's code.
    // naturalWidth stays 0 unless the bytes were actually fetched and decoded,
    // so this fails if API_BASE_URL resolved to the dev backend (which is not
    // running) instead of the Storybook origin — i.e. it is the check that
    // .storybook/env.ts is doing its job.
    await waitFor(() => expect((logo as HTMLImageElement).naturalWidth).toBeGreaterThan(0));
  },
};

/**
 * Field-level validation — the design system's `FormMessage`, which had never
 * rendered anywhere in this app before card KI-710.
 *
 * Reached the way a user reaches it: submit the form empty, so
 * `useFormValidation` fills `fieldErrors` and FieldRow renders a FormMessage
 * per row. Nothing is injected.
 */
export const FieldValidationErrors: Story = {
  tags: ['a11y-dark'],
  parameters: {
    api: { authProviders: { providers: [], localAuthEnabled: true } },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Anmelden' }));
    // Oracle: the German source string in src/translations.ts (`fieldRequired`),
    // one message per empty row. Read from the accessibility tree, not from
    // component state.
    await waitFor(async () => {
      await expect(await canvas.findAllByText('Dieses Feld ist erforderlich')).toHaveLength(2);
    });
  },
};

/**
 * Form-level failure — the `role="alert"` banner on `bg-error-container`,
 * the other surface card KI-710 introduced.
 *
 * Also reached through the real path: the credentials are typed and submitted,
 * and POST /api/auth/login answers 401, so the message is the one the server
 * sent.
 */
export const RejectedCredentials: Story = {
  tags: ['a11y-dark'],
  parameters: {
    api: {
      authProviders: { providers: [], localAuthEnabled: true },
      loginRejection: { status: 401, body: { error: 'Ungültiger Benutzername oder Passwort' } },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText('Benutzername'), 'j.doe');
    await userEvent.type(await canvas.findByLabelText('Passwort'), 'wrong-password');
    await userEvent.click(await canvas.findByRole('button', { name: 'Anmelden' }));
    // Oracle: the string the mocked HTTP response carried, surfaced through
    // the alert role. Independent of Login's own error handling — if it read
    // the wrong field off the response this assertion fails.
    const alert = await canvas.findByRole('alert');
    await expect(alert).toHaveTextContent('Ungültiger Benutzername oder Passwort');
  },
};
