import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import compression from 'vite-plugin-compression'
import { VitePWA } from 'vite-plugin-pwa'
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'

/**
 * Appends a content fingerprint to the icon URLs in index.html.
 *
 * Files under public/ are copied to the dist root verbatim, so their URLs
 * never change even when their bytes do. For most assets a revalidating
 * Cache-Control is enough to fix that — but not for favicons: Chrome stores
 * them in a dedicated SQLite database outside the HTTP cache, which a hard
 * reload and a private window both leave untouched. The only thing that
 * reliably retires a favicon there is a different URL.
 *
 * Hashing the file's own content (rather than stamping a build id) means the
 * URL changes exactly when the icon changes, so unrelated deploys don't force
 * a needless refetch. Missing files are left alone — a broken build is worse
 * than a stale icon.
 */
function versionedIcons(): Plugin {
  const ICONS = ['vite.svg', 'apple-touch-icon.png']

  const fingerprint = (file: string): string | null => {
    try {
      const bytes = readFileSync(new URL(`./public/${file}`, import.meta.url))
      return createHash('sha256').update(bytes).digest('hex').slice(0, 8)
    } catch {
      return null
    }
  }

  return {
    name: 'justrag-versioned-icons',
    transformIndexHtml(html) {
      return ICONS.reduce((acc, file) => {
        const hash = fingerprint(file)
        if (!hash) return acc
        // Only rewrite root-absolute references, which is how index.html
        // addresses public/ assets. Escape the dot in the filename.
        const pattern = new RegExp(`(href=")/${file.replace(/\./g, '\\.')}(")`, 'g')
        return acc.replace(pattern, `$1/${file}?v=${hash}$2`)
      }, html)
    },
  }
}


/**
 * Local design-system link — development only, opt-in via `DS_LOCAL`.
 *
 * The design system ships as a git dependency pinned to a tag
 * (`github:KI4JLU/JLU-Design-System#vX.Y.Z`), so every DS change normally costs
 * a commit, a tag, a push and a re-install before it can be seen here. With
 * `DS_LOCAL` set, the dev server resolves `@ki4jlu/design-system` to the SOURCE
 * of a local checkout instead, and a save in the DS repo hot-reloads in this
 * app with no build step at all.
 *
 *   npm run dev:ds                     # sibling checkout ../../JLU-Design-System
 *   DS_LOCAL=/abs/or/rel/path npm run dev
 *
 * Deliberately env-gated rather than a package.json/lockfile change (`npm link`,
 * `file:`): staging, production and CI resolve the pinned tarball exactly as
 * before, and there is nothing local that can be committed by accident.
 *
 * Three things have to move together, which is why this is one plugin and not
 * three scattered options:
 *
 *   1. MODULE resolution — the bare specifier is aliased to <ds>/src/index.ts.
 *      Exact-match regex, so the `/eslint-plugin` subpath is untouched (ESLint
 *      does not read this config anyway, it resolves through node_modules).
 *   2. CSS resolution — Tailwind 4 resolves `@import`/`@source` with its OWN
 *      resolver, which knows nothing about Vite aliases. So index.css is
 *      rewritten in a `pre` transform: the tokens import and the `@source`
 *      scan path are repointed at the checkout. Without the `@source` rewrite
 *      every DS utility class the local source newly uses would compile to
 *      nothing — and a wrong @source path throws no error, it silently scans
 *      nothing (see the comment on that line in index.css).
 *   3. DUPLICATE runtime copies — resolving DS source from outside this repo
 *      makes Node resolution walk up into the DS checkout's own node_modules,
 *      which has its own react (a devDependency there). Two React copies break
 *      hooks outright. `dedupe` forces these onto this app's copies — which is
 *      also what the published build does, since the DS build marks them all
 *      external.
 *
 * `tsc -b` and `vite build` do NOT honour this: types still come from the
 * installed package's .d.ts. Link for the dev loop, bump the pin before merging.
 */
function localDesignSystem(): Plugin | null {
  const requested = process.env.DS_LOCAL
  if (!requested) return null

  const webRoot = fileURLToPath(new URL('.', import.meta.url))
  const repoRoot = path.resolve(webRoot, '..')
  const dsRoot =
    requested === '1' || requested === 'true'
      ? path.resolve(webRoot, '../../JLU-Design-System')
      : path.resolve(webRoot, requested)

  const entry = path.join(dsRoot, 'src/index.ts')
  if (!existsSync(entry)) {
    // Fail loudly. A missing checkout that silently fell back to node_modules
    // would look exactly like "my DS change did not show up".
    throw new Error(
      `DS_LOCAL=${requested} does not look like a JLU-Design-System checkout: ` +
        `${entry} not found.`,
    )
  }

  const indexCss = path.join(webRoot, 'src/index.css')
  const relativeToIndexCss = (target: string): string => {
    const rel = path.relative(path.dirname(indexCss), target)
    return rel.startsWith('.') ? rel : `./${rel}`
  }

  return {
    name: 'justrag-local-design-system',
    // Must run before @tailwindcss/vite sees index.css.
    enforce: 'pre',
    config: () => ({
      resolve: {
        alias: [{ find: /^@ki4jlu\/design-system$/, replacement: entry }],
        dedupe: [
          'react',
          'react-dom',
          'lucide-react',
          'class-variance-authority',
          'clsx',
          'tailwind-merge',
        ],
      },
      // The alias points outside the project root; without this the dev
      // server refuses to serve the DS source files.
      server: { fs: { allow: [repoRoot, dsRoot] } },
      optimizeDeps: { exclude: ['@ki4jlu/design-system'] },
    }),
    configResolved() {
      console.log(`\n  \u001b[36m\u27a4\u001b[0m  design system linked: ${dsRoot}/src\n`)
    },
    transform(code, id) {
      if (id.split('?')[0] !== indexCss) return
      const tokens = relativeToIndexCss(path.join(dsRoot, 'src/tokens.css'))
      const source = relativeToIndexCss(path.join(dsRoot, 'src'))
      const linked = code
        .replace(
          '@import "@ki4jlu/design-system/tokens.css";',
          `@import "${tokens}";`,
        )
        .replace(
          '@source "../../node_modules/@ki4jlu/design-system";',
          `@source "${source}";`,
        )
      if (linked === code) {
        throw new Error(
          'justrag-local-design-system: neither the tokens @import nor the ' +
            '@source line was found in src/index.css — the rewrite is stale.',
        )
      }
      return linked
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    localDesignSystem(),
    react(),
    versionedIcons(),
    // Compiles the @ki4jlu/design-system `@theme` block in src/index.css into
    // CSS variables. Preflight is deliberately not imported — see index.css.
    tailwindcss(),
    ViteImageOptimizer(),
    compression({
      algorithm: 'gzip',
      ext: '.gz',
    }),
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
    }),
    VitePWA({
      // 'prompt' (not 'autoUpdate'): a freshly deployed service worker stays
      // in the waiting state and surfaces a user-driven reload prompt
      // (see components/ReloadPrompt.tsx) instead of silently swapping the
      // app shell mid-session. updateServiceWorker(true) posts SKIP_WAITING.
      registerType: 'prompt',
      includeAssets: ['vite.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'JLU RAG',
        short_name: 'JLU RAG',
        description: 'Advanced Knowledge Retrieval System',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png'
          },
          {
            src: 'vite.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          }
        ]
      },
      workbox: {
        // No skipWaiting here: the prompt flow needs the new SW to wait until
        // the user accepts, at which point updateServiceWorker(true) triggers
        // skip-waiting. clientsClaim lets the activated SW take control of the
        // already-open page on that reload.
        clientsClaim: true,
        // Exclude API calls from service worker caching — API responses
        // change with deployments and stale cached responses cause errors
        navigateFallbackDenylist: [/^\/api\//],
        // No runtimeCaching for fonts: they are self-hosted now, so they are
        // fingerprinted into /assets and precached like any other build
        // output. The previous CacheFirst rules for fonts.googleapis.com /
        // fonts.gstatic.com would never match again. woff2 is in the glob
        // below or the app drops to system fonts offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ],
  build: {
    target: 'es2022',
    // Never inline font files. Vite base64s any asset under 4 KiB into the
    // stylesheet, which would have swallowed the two smallest subsets — and an
    // inlined face is fetched by every visitor regardless of its unicode-range,
    // defeating the per-subset loading the @font-face sheet exists to get.
    assetsInlineLimit: (filePath: string) =>
      filePath.endsWith('.woff2') ? false : undefined,
    minify: 'oxc',
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Vite 8 uses rolldown, whose manualChunks is function-only (the
        // Rollup object form is unsupported). Same four vendor chunks, keyed
        // on the node_modules package path.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/]node_modules[\\/](framer-motion|motion|motion-dom|motion-utils|lucide-react)[\\/]/.test(id)) return 'vendor-ui';
          if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return 'vendor-charts';
          if (/[\\/]node_modules[\\/](react-markdown|remark-gfm)[\\/]/.test(id)) return 'vendor-markdown';
        },
      }
    }
  }
})
