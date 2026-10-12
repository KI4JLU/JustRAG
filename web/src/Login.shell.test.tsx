import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import Login from './Login';
import { API_BASE_URL } from './api';
import { translations } from './translations';

/* ---------------------------------------------------------------------------
 * This suite exists because of card KI-693, which replaced this page's
 * hand-built outer shell with the design system's `AuthLayout` TEMPLATE and
 * moved the two credential fields onto `FieldRow`. Login.test.tsx already
 * covers WHICH login methods render; nothing covered what the migration
 * actually changed:
 *
 *   1. label/control pairing — the explicit `id="username"` / `id="password"`
 *      and their `htmlFor` were dropped in favour of <FormControl>'s injected
 *      id, so a broken pairing would now be silent;
 *   2. the validation wiring — the two loose
 *      `<span className="field-error" role="alert">` became <FormMessage>,
 *      reached through FieldRow's `error` prop, and the form-level error's
 *      `id="login-error"` plus the two `aria-describedby` that pointed at it
 *      were removed;
 *   3. the page heading — `AuthLayout`'s `title` slot renders inside
 *      <CardTitle>, which is a <div>, so the page's only <h1> now comes from
 *      the call site and could vanish unnoticed;
 *   4. the submit path — the raw <button type="submit"> became a DS <Button>,
 *      so the form's one write path has to be re-checked.
 *
 * Every test names its oracle, and every oracle is an artifact other than
 * this component: the HTML Living Standard (through jsdom), WAI-ARIA, the Go
 * backend's login DTO, translations.ts, and a control census of the
 * PRE-migration source read out of git at the card's claim base
 * (`git show 272a27d:web/src/Login.tsx`).
 *
 * Nothing here uses a real credential and nothing asserts anything about a
 * token: the fixtures are obvious placeholders and the axios response is an
 * unexamined stub.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

// Login pulls in useReducedMotion which calls window.matchMedia,
// not available in jsdom by default.
vi.mock('./hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
  getMotionProps: () => ({}),
}));

const setLanguage = vi.fn();
// One stable object: `t` sits in a useEffect dependency list, so a fresh
// object per render would re-run the OIDC-fragment effect forever.
const themeMock = {
  theme: 'light' as const,
  resolvedTheme: 'light' as const,
  setTheme: () => {},
  language: 'en' as const,
  setLanguage,
  t: (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
  },
};
vi.mock('./contexts/ThemeContext', () => ({ useTheme: () => themeMock }));

const mockedGet = axios.get as unknown as Mock;
const mockedPost = axios.post as unknown as Mock;

const USERNAME_LABEL = translations.username.en;
const PASSWORD_LABEL = translations.password.en;

function renderLogin() {
  return render(<Login onLogin={vi.fn()} siteConfigs={{}} />);
}

/** Local username/password login enabled, no SSO provider. */
function mockLocalAuth() {
  mockedGet.mockResolvedValue({ data: { providers: [], localAuthEnabled: true } });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

describe('Login — label and control pairing', () => {
  it('pairs every rendered <label> with a labelable control', async () => {
    // ORACLE: the HTML Living Standard, section 4.10.4 — the set of LABELABLE
    // elements is exactly {button, input, meter, output, progress, select,
    // textarea}, and `HTMLLabelElement.control` is jsdom's implementation of
    // the spec's "labeled control" algorithm. Neither the set nor the
    // algorithm comes from this repo, so a label whose `htmlFor` dangles (the
    // exact failure mode of dropping the hand-written ids) resolves to null
    // and fails here.
    const LABELABLE = ['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea'];
    mockLocalAuth();
    const { container } = renderLogin();
    await screen.findByLabelText(USERNAME_LABEL);

    const labels = Array.from(container.querySelectorAll<HTMLLabelElement>('label'));
    // Guard against a vacuous pass: the two credential rows must be there.
    expect(labels.length).toBeGreaterThanOrEqual(2);

    for (const label of labels) {
      expect(label.control, `<label>${label.textContent}</label> has no control`).not.toBeNull();
      expect(LABELABLE).toContain(label.control!.tagName.toLowerCase());
    }
  });

  it('names both credential fields through their label, not a placeholder', async () => {
    // ORACLE: translations.ts (an independent data artifact) for the expected
    // names, and @testing-library/dom's own accessible-name lookup — a
    // third-party implementation of the ARIA name computation — for the
    // pairing. `getByLabelText` deliberately does NOT match a placeholder.
    mockLocalAuth();
    renderLogin();

    expect(await screen.findByLabelText(USERNAME_LABEL)).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(PASSWORD_LABEL)).toHaveAttribute('type', 'password');
  });
});

describe('Login — validation wiring', () => {
  it('leaves native constraint validation out of the form', async () => {
    // ORACLE: the HTML constraint-validation algorithm, run by jsdom through
    // `form.checkValidity()`. Card KI-710 established the rule this checks —
    // a required/min/max constraint on a DS control can land on a visually
    // hidden native input, where the browser refuses to submit and has
    // nowhere to show its bubble. An empty form must therefore be NATIVELY
    // valid: every constraint is the app's own.
    mockLocalAuth();
    const { container } = renderLogin();
    await screen.findByLabelText(USERNAME_LABEL);

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form!.querySelectorAll('[required]')).toHaveLength(0);
    expect(form!.querySelectorAll('[min], [max], [step]')).toHaveLength(0);
    expect(form!.checkValidity()).toBe(true);
  });

  it('blocks an empty submit through the app guard, not the browser', async () => {
    // ORACLE: useFormValidation's contract (both fields non-empty) plus the
    // backend's own precondition — go-backend/internal/authhandler/handler.go
    // rejects an empty username or password with 400 — so no request may
    // leave the page. The visible message must be announced, per WAI-ARIA's
    // `alert` role.
    mockLocalAuth();
    const { container } = renderLogin();
    await screen.findByLabelText(USERNAME_LABEL);

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('resolves every aria-describedby IDREF to a real element', async () => {
    // ORACLE: WAI-ARIA 1.2 — `aria-describedby` takes an ID reference LIST,
    // and every reference must resolve to an element in the same document; a
    // dangling reference is simply dropped by assistive technology. This is
    // the KI-692 defect class, and it is why the deleted `id="login-error"`
    // had to take its two references with it.
    mockLocalAuth();
    const { container } = renderLogin();
    await screen.findByLabelText(USERNAME_LABEL);

    // Empty submit so both FormMessages — the only descriptions this page
    // renders — are present.
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));

    const described = Array.from(container.querySelectorAll('[aria-describedby]'));
    // Guard against a vacuous pass: both credential controls describe
    // themselves once they carry an error.
    expect(described).toHaveLength(2);

    for (const el of described) {
      for (const id of el.getAttribute('aria-describedby')!.split(/\s+/).filter(Boolean)) {
        const target = document.getElementById(id);
        expect(target, `aria-describedby="${id}" resolves to nothing`).not.toBeNull();
        expect(target!.textContent?.trim()).not.toBe('');
        expect(target!.getAttribute('role')).toBe('alert');
      }
    }
  });
});

describe('Login — control census', () => {
  it('renders the same controls the pre-migration source did', async () => {
    // ORACLE: a census of the PRE-migration file, taken from git at the
    // card's claim base and therefore an artifact independent of the code
    // under test — `git show 272a27d:web/src/Login.tsx` contains
    //   2 raw <input>  = 1 type="text" (username) + 1 type="password"
    //   2 raw <button> = 1 language toggle + 1 type="submit"
    //   1 <form>, 1 <h1>, 1 <a> (the SSO link, counted in the OIDC test below)
    // The migration must preserve every one of them. The <h1> matters most:
    // AuthLayout's `title` slot renders inside <CardTitle>, which is a <div>,
    // so a dropped heading would leave the app's landing page with none.
    mockLocalAuth();
    const { container } = renderLogin();
    await screen.findByLabelText(USERNAME_LABEL);

    expect(container.querySelectorAll('input')).toHaveLength(2);
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(1);
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(translations.welcomeBack.en);
  });

  it('keeps the language toggle reachable by its accessible name', async () => {
    // ORACLE: the aria-label strings are literals in the pre-migration source
    // (lines 182-183 at the claim base) and are unchanged by this card, so the
    // control is addressable exactly as before even though it moved out of the
    // card's corner into the template's `footer` slot.
    mockLocalAuth();
    renderLogin();
    await screen.findByLabelText(USERNAME_LABEL);

    const toggle = screen.getByRole('button', { name: 'Zu Deutsch wechseln' });
    fireEvent.click(toggle);
    expect(setLanguage).toHaveBeenCalledWith('de');
  });

  it('keeps the SSO link an anchor pointing at the OIDC start endpoint', async () => {
    // ORACLE: go-backend/internal/app/routes.go registers
    // `GET /api/auth/oidc/login` as the browser redirect entry point. It has
    // to stay a real navigation — <Button asChild> styles the anchor, it must
    // not replace it with a <button>, which would not navigate at all.
    mockedGet.mockResolvedValue({
      data: { providers: [{ id: 'p1', type: 'oidc', name: 'Azure AD' }], localAuthEnabled: false },
    });
    const { container } = renderLogin();

    const link = await screen.findByRole('link', { name: /Azure AD/ });
    expect(link.tagName.toLowerCase()).toBe('a');
    expect(link).toHaveAttribute('href', `${API_BASE_URL}/api/auth/oidc/login`);
    expect(container.querySelectorAll('form')).toHaveLength(0);
  });
});

describe('Login — the submit path survives the control swap', () => {
  it('posts exactly the login DTO the backend declares', async () => {
    // ORACLE: the Go backend's own request type —
    // go-backend/internal/authhandler/handler.go:83-86
    //   type loginRequest struct {
    //     Username string `json:"username"`
    //     Password string `json:"password"`
    //   }
    // registered at `POST /api/auth/login` (internal/app/routes.go). The
    // assertion is an exact object match, so a field renamed or smuggled in by
    // the FieldRow swap fails. Both values are obvious placeholders; the
    // response is an unexamined stub and nothing here inspects a token.
    mockLocalAuth();
    mockedPost.mockResolvedValue({
      data: { token: 'stub-not-asserted', user: { id: '1', username: 'ada-fixture', role: 'user' } },
    });
    const { container } = renderLogin();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(USERNAME_LABEL), 'ada-fixture');
    await user.type(screen.getByLabelText(PASSWORD_LABEL), 'placeholder-not-a-secret');
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith(`${API_BASE_URL}/api/auth/login`, {
      username: 'ada-fixture',
      password: 'placeholder-not-a-secret',
    });
  });
});
