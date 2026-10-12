import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------------------------------------------------------------------------
 * Control-byte guard for the frontend sources (card KI-766).
 *
 * THE BUG THIS EXISTS FOR
 * `web/src/components/ChatView.tsx` carried a single raw 0x00 byte inside a
 * template literal (the `promptResetKey` separator, written as the byte rather
 * than as the escape `\0`). One byte was enough to make `file(1)` classify the
 * repo's largest component as `data`, and everything downstream of that
 * classification went quiet rather than loud:
 *   - `grep`/`grep -r` SKIPPED the file entirely: no match, exit 1, no
 *     "Binary file matches" line. Two audits in one session read that empty
 *     output as a genuine absence. KI-779's worker missed ChatView's copy of
 *     the theme button that way; only `tsc -b` caught it.
 *   - `git diff` reported "Binary files … differ" with NO HUNKS, so a reviewer
 *     diffing a change to this file saw nothing at all.
 * Neither failure announces itself. That is why a guard is cheaper than
 * vigilance.
 *
 * THE INVARIANT
 * No source file under `web/src` or `web/.storybook` contains a C0 control
 * byte other than tab (0x09), LF (0x0A) or CR (0x0D), nor DEL (0x7F). Those
 * three are the only control characters that legitimately occur in source
 * text; every other one either is invisible in an editor or flips a tool into
 * binary mode, and both of those are the defect.
 *
 * THE ORACLE
 * The byte values, from the ASCII/Unicode C0 definition — not from anything
 * this repo computes. The fixtures below are built byte by byte, so the
 * expected offsets are a property of how the fixture was assembled and are
 * known before `findControlBytes` runs. The walker is exercised against a
 * temporary directory with a planted NUL (the mutation check) so a green live
 * scan cannot mean "the walk found nothing to look at".
 *
 * SCOPE, stated plainly: text sources only. Fonts (`.woff2`) and any other
 * binary asset under `src/` are legitimately full of control bytes and are
 * excluded by the extension allowlist, not by a content heuristic.
 * ------------------------------------------------------------------------- */

/** Tab, LF, CR — the only control characters allowed in source text. */
const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]);

/** Byte offsets of every disallowed control byte. */
function findControlBytes(bytes: Uint8Array): number[] {
  const hits: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ((b < 0x20 && !ALLOWED_CONTROL_BYTES.has(b)) || b === 0x7f) hits.push(i);
  }
  return hits;
}

/** Extensions that are text by definition. Anything else is not scanned. */
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.json', '.html', '.md', '.svg',
]);

/** Every text-source file under `roots`, as repo-relative-ish paths. */
function collectSourceFiles(roots: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  };
  for (const root of roots) walk(root);
  return found.sort();
}

/** `{ file, offsets }` for every scanned file that carries a control byte. */
function scanRoots(roots: string[]): { files: string[]; offenders: { file: string; offsets: number[] }[] } {
  const files = collectSourceFiles(roots);
  const offenders = files
    .map(file => ({ file, offsets: findControlBytes(readFileSync(file)) }))
    .filter(hit => hit.offsets.length > 0);
  return { files, offenders };
}

// Not `new URL('…', import.meta.url)`: Vite rewrites that pattern into a
// dev-server URL and `fileURLToPath` then throws. Same reason as in
// ChatView.composer.test.ts.
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', '..');
const SCAN_ROOTS = [path.join(webRoot, 'src'), path.join(webRoot, '.storybook')];

describe('findControlBytes', () => {
  it('flags the KI-766 defect: a raw NUL inside a template literal', () => {
    // Built byte by byte, so the expected offset is the length of the first
    // half — known before the detector is called.
    const head = Buffer.from("const promptResetKey = `${currentKb?.id ?? ''}", 'utf8');
    const tail = Buffer.from("${currentKb?.systemPrompt ?? ''}`;", 'utf8');
    const defect = Buffer.concat([head, Buffer.from([0x00]), tail]);

    expect(findControlBytes(defect)).toEqual([head.length]);
  });

  it('passes the same line once the byte is written as the escape', () => {
    // Two source characters, backslash + zero — the fix that went into
    // ChatView.tsx. Same runtime string, no control byte in the file.
    const fixed = Buffer.from(
      "const promptResetKey = `${currentKb?.id ?? ''}\\0${currentKb?.systemPrompt ?? ''}`;",
      'utf8',
    );
    expect(fixed.includes(0x00)).toBe(false);
    expect(findControlBytes(fixed)).toEqual([]);
  });

  it('allows tab, LF and CR', () => {
    expect(findControlBytes(Buffer.from([0x09, 0x41, 0x0a, 0x0d, 0x42]))).toEqual([]);
  });

  it('allows multi-byte UTF-8 — an em dash or an emoji is not a control byte', () => {
    // Every continuation byte is >= 0x80, so a byte-level scan must not
    // mistake them for control characters. ChatView.tsx is full of both.
    expect(findControlBytes(Buffer.from('— 🙂 äöü', 'utf8'))).toEqual([]);
  });

  it('flags the other invisible offenders: ESC, VT, form feed, DEL', () => {
    // Offsets 1, 3, 5, 7 by construction.
    const bytes = Buffer.from([0x41, 0x1b, 0x41, 0x0b, 0x41, 0x0c, 0x41, 0x7f]);
    expect(findControlBytes(bytes)).toEqual([1, 3, 5, 7]);
  });
});

describe('the walker', () => {
  it('finds a planted control byte in a nested file (mutation check)', () => {
    // Proves the guard below can fail. A scan that only ever returns [] is
    // indistinguishable from a scan that never opened a file.
    const dir = mkdtempSync(path.join(tmpdir(), 'ctrl-bytes-'));
    const nested = path.join(dir, 'components');
    mkdirSync(nested, { recursive: true });
    const clean = path.join(nested, 'Clean.tsx');
    const dirty = path.join(nested, 'Dirty.tsx');
    writeFileSync(clean, 'export const ok = 1;\n');

    const head = Buffer.from('export const x = `a', 'utf8');
    writeFileSync(dirty, Buffer.concat([head, Buffer.from([0x00]), Buffer.from('b`;\n', 'utf8')]));
    // A binary asset with a non-text extension must NOT be reported.
    writeFileSync(path.join(nested, 'font.woff2'), Buffer.from([0x00, 0x01, 0x02]));

    const { files, offenders } = scanRoots([dir]);

    expect(files).toContain(clean);
    expect(files).toContain(dirty);
    expect(files.some(f => f.endsWith('.woff2'))).toBe(false);
    expect(offenders).toEqual([{ file: dirty, offsets: [head.length] }]);
  });
});

describe('web/src and web/.storybook', () => {
  const { files, offenders } = scanRoots(SCAN_ROOTS);

  it('contains no control bytes outside tab, LF and CR', () => {
    const report = offenders
      .map(o => `${path.relative(webRoot, o.file)} @ byte ${o.offsets.join(', ')}`)
      .join('\n');
    expect(report).toBe('');
  });

  it('really scanned the tree — including the file this card is about', () => {
    // Vacuum protection: without this, deleting the roots would make the
    // guard above green.
    expect(files.length).toBeGreaterThan(300);
    expect(files.map(f => path.relative(webRoot, f))).toContain(
      path.join('src', 'components', 'ChatView.tsx'),
    );
  });
});
