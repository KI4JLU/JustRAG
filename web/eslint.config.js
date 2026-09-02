import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import designSystem from '@ki4jlu/design-system/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    plugins: {
      'design-system': designSystem,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // eslint-plugin-react-hooks 7.1 promoted this to an error in the
      // recommended preset. Our remaining hits are idiomatic fetch-on-mount /
      // prop-sync effects (synchronous setLoading(true) before an await), not
      // cascading-render bugs — keep it visible as a warning to address
      // incrementally rather than blocking lint or forcing risky rewrites.
      'react-hooks/set-state-in-effect': 'warn',

      // Design-system enforcement (Stufe 0 of the DS adoption, card KI-595).
      // All three are `error` on purpose — the point is that neither a human
      // nor an agent can hand-roll a control or a colour and still get a green
      // lint.
      //
      // no-raw-ui-elements carries ~690 pre-existing hits. They are NOT
      // downgraded to `warn`; every one of them is named in
      // web/eslint-suppressions.json, which is a committed burn-down list.
      // A NEW raw <button>/<input> is therefore an error, while the known
      // backlog stays green. Removing an entry from the catalogue is the
      // migration unit for Stufe 1 (card KI-94).
      'design-system/no-raw-ui-elements': 'error',
      // Zero hits today, and deliberately armed BEFORE the first DS component
      // lands: it forbids re-skinning a DS control at the call site, so it has
      // to exist before there is anything to re-skin.
      'design-system/layout-only-classname': 'error',
      'design-system/no-hardcoded-colors': 'error',
    },
  },
  {
    files: ['src/contexts/**/*.tsx'],
    rules: {
      // Context modules intentionally export Provider + hook together; an HMR
      // update of a context invalidates its consumers, which is acceptable.
      'react-refresh/only-export-components': 'off',
    },
  },
])
